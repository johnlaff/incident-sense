"""POST /api/incidents/{number}/ask: a follow-up question about the analysis.

The first question in the assistant is the full suggestion (``/api/suggest``).
Everything typed afterwards comes here: one model call, grounded only on the
incident record and the cases that analysis kept, with the same citation check
as the suggestion. It never publishes a work note, and it is metered like the
suggestion. A greeting gets a short reply without calling the model.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Annotated

import openai
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ValidationError

from incident_sense.api.incidents import RepoDep as IncidentRepoDep
from incident_sense.api.problems import RepoDep as ProblemRepoDep
from incident_sense.config import get_settings, resolve_chat_model
from incident_sense.guard import UsageGuard, _client_ip, client_key, get_usage_guard
from incident_sense.logging import get_logger
from incident_sense.models.ask import AskKind, AskRequest, AskResponse
from incident_sense.models.incident import Incident
from incident_sense.models.problem import Problem
from incident_sense.providers import extract_json, make_chat_client
from incident_sense.rag.clients import LLMClient, OpenAILLMClient
from incident_sense.rag.pipeline import validate_citations

router = APIRouter(tags=["ask"])
log = get_logger(__name__)

_ASK_SYSTEM = (
    "Você é o assistente de um analista de suporte de TI de um banco. Responda à "
    "PERGUNTA usando SOMENTE o INCIDENTE e os CASOS abaixo (incidentes resolvidos e "
    "Problemas que a análise já encontrou). Não invente fatos, comandos, prazos nem "
    "nomes. Responda em português do Brasil, em até 120 palavras, direto ao ponto. "
    "Cite entre colchetes o identificador de cada caso que usar, por exemplo "
    "[INC0052110] ou [PRB0004103]; cite só identificadores dos CASOS. "
    'Responda apenas com JSON: {"kind": "answer" | "not_in_cases" | "off_topic", '
    '"answer": "<texto>"}. Use "not_in_cases" quando o incidente e os casos não '
    "respondem à pergunta: diga isso claramente e o que eles cobrem. Use "
    '"off_topic" quando a pergunta não é sobre este incidente: diga em uma frase que '
    "você responde sobre este incidente, a sugestão e os casos parecidos."
)

_GREETING = re.compile(
    r"^(oi+|ola|ole|opa|e ai|eai|hey|hello|hi|bom dia|boa tarde|boa noite|tudo bem|"
    r"obrigad[oa]|valeu|vlw|brigad[oa]|ok|okay|beleza|blz|teste|testando)$"
)


def get_ask_llm() -> LLMClient:
    """The chat model for follow-ups, or a clear 503 without a key."""
    settings = get_settings()
    if not settings.has_llm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key is not configured. Set OPENROUTER_API_KEY in your .env.",
        )
    return OpenAILLMClient(make_chat_client(settings), settings.llm_model, reasoning=False)


LLMDep = Annotated[LLMClient, Depends(get_ask_llm)]


def _bare(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", plain).split())


def is_small_talk(question: str) -> bool:
    """A greeting, a thanks or punctuation only: nothing to look up."""
    bare = _bare(question)
    return not bare or bool(_GREETING.match(bare))


def _hello(number: str) -> str:
    return (
        f"Oi! Posso responder perguntas sobre o {number}: a resolução sugerida, por que "
        "a IA escolheu esses casos, ou o que cada caso parecido fez. Por exemplo: "
        '"Qual é o primeiro passo?" ou "O que o Problema diz sobre a causa?"'
    )


def _incident_block(incident: Incident) -> str:
    return (
        f"[{incident.number}] {incident.short_description}\n"
        f"Descrição: {incident.description}\n"
        f"Prioridade: {incident.priority} · Impacto: {incident.impact} · "
        f"Urgência: {incident.urgency}\n"
        f"Estado: {incident.state} · Grupo responsável: {incident.assignment_group}\n"
        f"Serviço: {incident.cmdb_ci} · Categoria: {incident.category} / "
        f"{incident.subcategory}"
    )


def _case_block(case: Incident | Problem) -> str:
    if isinstance(case, Problem):
        return (
            f"[{case.number}] Problema: {case.short_description}\n"
            f"Causa raiz: {case.root_cause}\n"
            f"Contorno: {case.workaround}\n"
            f"Solução definitiva: {case.permanent_fix}"
        )
    return f"[{case.number}] {case.short_description}\nResolução: {case.resolution_notes}"


class _AskOut(BaseModel):
    kind: AskKind = "answer"
    answer: str


def _parse(raw: str) -> _AskOut:
    """The JSON the prompt asks for; plain prose is read as an answer."""
    try:
        data = extract_json(raw)
        if isinstance(data, dict):
            return _AskOut.model_validate(data)
    except (ValueError, ValidationError):
        pass
    return _AskOut(kind="answer", answer=raw.strip())


@router.post("/incidents/{number}/ask", response_model=AskResponse)
def ask(
    number: str,
    request: AskRequest,
    incidents: IncidentRepoDep,
    problems: ProblemRepoDep,
    guard: Annotated[UsageGuard, Depends(get_usage_guard)],
    llm: LLMDep,
    http: Request,
) -> AskResponse:
    """Answer one follow-up from the incident and the kept cases only."""
    number = number.strip().upper()
    incident = incidents.get(number)
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Incidente {number} não encontrado.",
        )
    if is_small_talk(request.question):
        return AskResponse(kind="off_topic", answer=_hello(number))

    settings = get_settings()
    refused = guard.check(client_id=client_key(http), ip=_client_ip(http), settings=settings)
    if refused:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=refused)

    # Only real records count as context: a resolved incident with its
    # resolution, or a Problem. The incident itself is never its own source.
    cases: list[Incident | Problem] = []
    for raw_id in dict.fromkeys(i.strip().upper() for i in request.context_ids):
        found: Incident | Problem | None = (
            problems.get(raw_id) if raw_id.startswith("PRB") else incidents.get(raw_id)
        )
        if found is None or found.number == number:
            continue
        if isinstance(found, Incident) and not found.is_resolved:
            continue
        cases.append(found)
    kept = [c.number for c in cases]

    user = (
        f"INCIDENTE\n{_incident_block(incident)}\n\n"
        "CASOS (cite estes identificadores):\n"
        + ("\n\n".join(_case_block(c) for c in cases) or "(nenhum caso foi mantido)")
        + f"\n\nPERGUNTA\n{request.question.strip()}"
    )
    chosen = resolve_chat_model(request.model, settings)
    if chosen != settings.llm_model and isinstance(llm, OpenAILLMClient):
        llm = OpenAILLMClient(make_chat_client(settings), chosen, reasoning=False)
    try:
        raw = llm.complete(_ASK_SYSTEM, user, temperature=0.2, max_tokens=400)
    except openai.APITimeoutError as exc:
        log.error("ask_failed", error=str(exc), error_type="timeout")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="A IA demorou demais para responder. Tente de novo.",
        ) from exc
    except openai.APIStatusError as exc:
        log.error("ask_failed", error=str(exc), status=exc.status_code)
        if exc.status_code in (402, 429):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="A IA está sem cota agora. Tente de novo mais tarde.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível responder agora. Tente de novo em instantes.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - a clean message for the chat.
        log.error("ask_failed", error=str(exc), error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível responder agora. Tente de novo em instantes.",
        ) from exc

    out = _parse(raw)
    # The incident's own number may appear in prose; it is not a source.
    text, check = validate_citations(out.answer, [*kept, number])
    check.cited = [c for c in check.cited if c != number]
    log.info("ask_answered", incident=number, kind=out.kind, cited=check.cited)
    return AskResponse(kind=out.kind, answer=text, citations=check, context_ids=kept)
