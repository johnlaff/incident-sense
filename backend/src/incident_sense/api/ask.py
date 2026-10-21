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
from pydantic import BaseModel

from incident_sense.api.incidents import RepoDep as IncidentRepoDep
from incident_sense.api.problems import RepoDep as ProblemRepoDep
from incident_sense.config import get_settings, resolve_chat_model
from incident_sense.data.analyses import AnalysisMemory, AnalysisStore, get_analysis_store
from incident_sense.guard import UsageGuard, _client_ip, client_key, get_ask_guard
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
    "PERGUNTA usando SOMENTE o INCIDENTE, a ANÁLISE JÁ FEITA (o veredito e a "
    "SUGESTÃO JÁ MOSTRADA à pessoa) e os CASOS abaixo (incidentes resolvidos e "
    "Problemas que a análise manteve). Sobre os passos da resolução, siga a SUGESTÃO "
    "já mostrada, na mesma ordem: não proponha outra ordem nem outro primeiro passo. "
    "Seja coerente com o veredito: num chamado improcedente não há resolução técnica. "
    "Não invente fatos, comandos, prazos nem nomes. "
    "Responda em português do Brasil, em até 120 palavras, direto ao ponto. "
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


# The words the screen uses for the record's codes (frontend lib/model.ts), so
# the answer never says "Prioridade 1" or "In Progress" next to "Crítica".
PRIORITY_LABEL = {1: "Crítica", 2: "Alta", 3: "Moderada", 4: "Baixa"}
IMPACT_LABEL = {1: "Alto", 2: "Médio", 3: "Baixo"}
URGENCY_LABEL = {1: "Alta", 2: "Média", 3: "Baixa"}
STATE_LABEL = {
    "New": "Aberto",
    "In Progress": "Em andamento",
    "On Hold": "Em espera",
    "Resolved": "Resolvido",
    "Closed": "Resolvido",
}
_KINDS = {"answer", "not_in_cases", "off_topic"}


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


def _hello(number: str, memory: AnalysisMemory | None) -> str:
    """A greeting that offers only what the analysis has (logica-5 P2-4)."""
    if memory is not None and memory.classification != "PROCEDENTE":
        return (
            f"Oi! Posso responder perguntas sobre o {number}: o veredito da análise e o "
            'motivo dele. Por exemplo: "Por que não é um incidente?"'
        )
    if memory is not None and not memory.suggestion:
        return (
            f"Oi! Posso responder perguntas sobre o {number}: o veredito da análise e por "
            'que ela não trouxe uma sugestão. Por exemplo: "O que faltou para sugerir?"'
        )
    if memory is None:
        return (
            f"Oi! Posso responder perguntas sobre o {number} e a análise da IA: o veredito, "
            "a sugestão quando houver e os casos parecidos que ela usou."
        )
    return (
        f"Oi! Posso responder perguntas sobre o {number}: a resolução sugerida, por que "
        "a IA escolheu esses casos, ou o que cada caso parecido fez. Por exemplo: "
        '"Qual é o primeiro passo?" ou "O que o Problema diz sobre a causa?"'
    )


def _incident_block(incident: Incident) -> str:
    return (
        f"[{incident.number}] {incident.short_description}\n"
        f"Descrição: {incident.description}\n"
        f"Prioridade: {PRIORITY_LABEL.get(int(incident.priority), incident.priority)} · "
        f"Impacto: {IMPACT_LABEL.get(int(incident.impact), incident.impact)} · "
        f"Urgência: {URGENCY_LABEL.get(int(incident.urgency), incident.urgency)}\n"
        f"Estado: {STATE_LABEL.get(str(incident.state), incident.state)} · "
        f"Grupo responsável: {incident.assignment_group}\n"
        f"Serviço: {incident.cmdb_ci} · Categoria: {incident.category} / "
        f"{incident.subcategory}"
    )


def _case_block(case: Incident | Problem, reason: str | None) -> str:
    why = f"\nPor que a análise manteve: {reason}" if reason else ""
    if isinstance(case, Problem):
        return (
            f"[{case.number}] Problema: {case.short_description}\n"
            f"Causa raiz: {case.root_cause}\n"
            f"Contorno: {case.workaround}\n"
            f"Solução definitiva: {case.permanent_fix}{why}"
        )
    return f"[{case.number}] {case.short_description}\nResolução: {case.resolution_notes}{why}"


def _analysis_block(memory: AnalysisMemory) -> str:
    verdict = (
        "PROCEDENTE (é um incidente de verdade)"
        if memory.classification == "PROCEDENTE"
        else "IMPROCEDENTE (não é uma falha do sistema)"
    )
    shown = memory.suggestion or (
        "(nenhuma: chamado improcedente, sem resolução técnica)"
        if memory.classification != "PROCEDENTE"
        else "(nenhuma: os casos não bastaram para uma sugestão)"
    )
    return (
        f"Veredito: {verdict}\nJustificativa: {memory.justification}\n\n"
        f"SUGESTÃO JÁ MOSTRADA\n{shown}"
    )


class _AskOut(BaseModel):
    kind: AskKind = "answer"
    answer: str


class _EmptyAnswerError(Exception):
    """The model answered nothing usable."""


def _parse(raw: str) -> _AskOut:
    """The JSON the prompt asks for, read tolerantly; plain prose is an answer.

    The kind is read without case and an unknown one is an answer; a JSON
    object never reaches the screen as text, and an empty answer is an error
    the chat can retry (logica-4 P2-1, P2-2).
    """
    text = raw.strip()
    try:
        data = extract_json(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        answer = data.get("answer")
        kind = str(data.get("kind") or "answer").strip().lower()
        if not isinstance(answer, str) or not answer.strip():
            raise _EmptyAnswerError
        return _AskOut(kind=kind if kind in _KINDS else "answer", answer=answer.strip())  # type: ignore[arg-type]
    if not text or text.startswith(("{", "[")):
        raise _EmptyAnswerError
    return _AskOut(kind="answer", answer=text)


@router.post("/incidents/{number}/ask", response_model=AskResponse)
def ask(
    number: str,
    request: AskRequest,
    incidents: IncidentRepoDep,
    problems: ProblemRepoDep,
    guard: Annotated[UsageGuard, Depends(get_ask_guard)],
    analyses: Annotated[AnalysisStore, Depends(get_analysis_store)],
    llm: LLMDep,
    http: Request,
) -> AskResponse:
    """Answer one follow-up from the incident and this visitor's last analysis."""
    number = number.strip().upper()
    incident = incidents.get(number)
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Incidente {number} não encontrado.",
        )
    # The analysis the person is looking at, as the server ran it: the browser
    # never says which cases count (logica-4 P1-2, P2-13).
    memory = analyses.get(client_key(http), number)
    if is_small_talk(request.question):
        return AskResponse(kind="off_topic", answer=_hello(number, memory))
    if memory is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Analise o incidente primeiro: a pergunta parte da análise da IA.",
        )
    # Another tab ran a newer analysis: answer about the one on this page only
    # after the page re-syncs (logica-5 P2-2).
    if request.analysis_id and memory.id and request.analysis_id != memory.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A análise mudou em outra aba: a IA analisa de novo antes de responder.",
        )

    settings = get_settings()
    refused = guard.check(
        client_id=client_key(http),
        ip=_client_ip(http),
        settings=settings,
        max_per_client=settings.ai_ask_max_per_client,
        max_per_ip=settings.ai_ask_max_per_ip,
        noun="perguntas",
    )
    if refused:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=refused)

    # Only real records count as context: a resolved incident with its
    # resolution, or a Problem. The incident itself is never its own source.
    cases: list[Incident | Problem] = []
    for raw_id in dict.fromkeys(i.strip().upper() for i in memory.kept):
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
        f"ANÁLISE JÁ FEITA\n{_analysis_block(memory)}\n\n"
        "CASOS (cite estes identificadores):\n"
        + (
            "\n\n".join(_case_block(c, memory.reasons.get(c.number)) for c in cases)
            or "(Esta análise não usou casos parecidos.)"
        )
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

    try:
        out = _parse(raw)
    except _EmptyAnswerError as exc:
        log.error("ask_failed", error="empty answer")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível responder agora. Tente de novo em instantes.",
        ) from exc
    # The incident's own number may appear in prose; it is not a source.
    text, check = validate_citations(out.answer, [*kept, number])
    check.cited = [c for c in check.cited if c != number]
    log.info("ask_answered", incident=number, kind=out.kind, cited=check.cited)
    return AskResponse(kind=out.kind, answer=text, citations=check, context_ids=kept)
