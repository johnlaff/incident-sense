"""Auditoria de lógica, rodada 4 (bugs-logica-4.md) e E2E rodada 4.

The follow-up chat answers from the analysis the person is looking at (held on
the server, not sent by the browser), reads the model's reply tolerantly, and
re-running an analysis does not stack notes. Plus the Change decision fixes.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from incident_sense.api.ask import get_ask_llm
from incident_sense.data.analyses import AnalysisMemory

SUGGESTION = (
    "1. **Expirar as sessões antigas**: invalidar as sessões emitidas antes do deploy "
    "[PRB0004105].\n\n2. **Reverter a validação do token** [INC0052219]."
)


class _LLM:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str, **_: object) -> str:
        self.calls.append((system, user))
        return self.reply


def _remember(client: TestClient, **over: object) -> None:
    memory = {
        "classification": "PROCEDENTE",
        "justification": "Falha técnica no login após o deploy.",
        "suggestion": SUGGESTION,
        "kept": ["INC0052219", "PRB0004105"],
        "reasons": {"INC0052219": "mesma causa: token inválido após deploy"},
        **over,
    }
    client.app.state.analysis_store.put(  # type: ignore[attr-defined]
        "aluno-1", "INC0052233", AnalysisMemory.model_validate(memory)
    )


def _wire(client: TestClient, reply: str) -> _LLM:
    llm = _LLM(reply)
    client.app.dependency_overrides[get_ask_llm] = lambda: llm  # type: ignore[attr-defined]
    return llm


def _ask(client: TestClient, question: str, context_ids: list[str] | None = None):
    return client.post(
        "/api/incidents/INC0052233/ask",
        json={"question": question, "context_ids": context_ids or []},
        headers={"X-Client-Id": "aluno-1"},
    )


# --- P1-2: the follow-up sees the suggestion and the verdict ----------------------
def test_the_prompt_carries_the_suggestion_shown_and_the_verdict(client: TestClient) -> None:
    _remember(client)
    llm = _wire(
        client, json.dumps({"kind": "answer", "answer": "Expirar as sessões [PRB0004105]."})
    )
    assert _ask(client, "Qual é o primeiro passo?").status_code == 200
    system, user = llm.calls[0]
    assert "SUGESTÃO JÁ MOSTRADA" in user
    assert "Expirar as sessões antigas" in user
    assert "PROCEDENTE" in user and "Falha técnica no login" in user
    assert "token inválido após deploy" in user  # why the case was kept
    assert "siga a SUGESTÃO" in system


def test_cases_come_from_the_server_not_from_the_browser(client: TestClient) -> None:
    _remember(client)
    llm = _wire(client, json.dumps({"kind": "answer", "answer": "Veja [INC0051986]."}))
    body = _ask(client, "E aí, como resolvo?", ["INC0051986", "INC0052219"]).json()
    assert body["context_ids"] == ["INC0052219", "PRB0004105"]
    assert "[INC0051986]" not in llm.calls[0][1]
    assert body["citations"]["cited"] == []


def test_without_an_analysis_on_the_server_the_question_waits_for_one(
    client: TestClient,
) -> None:
    llm = _wire(client, json.dumps({"kind": "answer", "answer": "x"}))
    r = _ask(client, "Como resolvo?")
    assert r.status_code == 409
    assert "Analise" in r.json()["detail"]
    assert llm.calls == []
    # A greeting needs no analysis.
    hello = _ask(client, "oi")
    assert hello.status_code == 200
    assert hello.json()["kind"] == "off_topic"


def test_improcedente_says_it_used_no_cases(client: TestClient) -> None:
    _remember(
        client,
        classification="IMPROCEDENTE",
        justification="Pedido de autoatendimento: redefinir a senha.",
        suggestion=None,
        kept=[],
    )
    llm = _wire(client, json.dumps({"kind": "answer", "answer": "Oriente o cliente."}))
    _ask(client, "Como eu resolvo isso?")
    user = llm.calls[0][1]
    assert "IMPROCEDENTE" in user and "autoatendimento" in user
    assert "esta análise não usou casos parecidos" in user.lower()


def test_record_values_reach_the_model_as_the_screen_says_them(client: TestClient) -> None:
    _remember(client)
    llm = _wire(client, json.dumps({"kind": "answer", "answer": "x"}))
    _ask(client, "Qual a prioridade?")
    user = llm.calls[0][1]
    assert "Prioridade: Crítica" in user
    assert "Estado: Em andamento" in user
    assert "Impacto: Alto" in user and "Urgência: Alta" in user
    assert "In Progress" not in user and "Prioridade: 1" not in user


# --- P2-1, P2-2: tolerant reading of the reply -------------------------------------
@pytest.mark.parametrize(
    ("raw", "kind"),
    [
        ('{"kind": "NOT_IN_CASES", "answer": "Os casos não dizem quem cuida."}', "not_in_cases"),
        ('{"kind": "Off_Topic", "answer": "Só falo deste incidente."}', "off_topic"),
        ('{"kind": "refusal", "answer": "Os casos não dizem."}', "answer"),
        ('{"answer": "Expire as sessões."}', "answer"),
    ],
)
def test_kind_is_read_tolerantly_and_json_never_shows(
    client: TestClient, raw: str, kind: str
) -> None:
    _remember(client)
    _wire(client, raw)
    body = _ask(client, "Quem cuida?").json()
    assert body["kind"] == kind
    assert "{" not in body["answer"] and '"kind"' not in body["answer"]


@pytest.mark.parametrize(
    "raw", ['{"kind": "answer", "answer": ""}', '{"kind": "answer", "answer": null}', "   "]
)
def test_an_empty_answer_is_an_error_with_retry(client: TestClient, raw: str) -> None:
    _remember(client)
    _wire(client, raw)
    r = _ask(client, "Como resolvo?")
    assert r.status_code == 502
    assert "Não foi possível responder" in r.json()["detail"]


# --- E2E P2-3: re-running the analysis does not stack notes ------------------------
def test_running_the_analysis_again_keeps_one_note_and_remembers_it(client: TestClient) -> None:
    from incident_sense.api.incidents import get_incident_repository, get_work_notes
    from incident_sense.api.suggest import get_rag_deps
    from incident_sense.data.repository import IncidentRepository
    from incident_sense.data.work_notes import WorkNotesStore
    from incident_sense.models import Incident
    from incident_sense.rag.clients import RagDeps, RetrievedHit

    incident = Incident.model_validate(
        {
            "number": "INC0099999",
            "short_description": "Pix sem comprovante",
            "description": "Valor debitado, comprovante não gerado.",
            "category": "Pagamentos",
            "subcategory": "Pix",
            "cmdb_ci": "PIX-Core",
            "assignment_group": "Service-Desk-N1",
            "priority": 2,
            "impact": 1,
            "urgency": 1,
            "state": "New",
            "opened_at": "2026-06-15T09:00:00",
        }
    )
    repo = IncidentRepository([incident])
    notes = WorkNotesStore()
    texts = iter(["Reprocesse a conciliação [INC0000001].", "Reinicie o worker [INC0000001]."])

    class _Pipe:
        def complete(self, system: str, user: str, **_: object) -> str:
            if "consulta de busca" in system:
                return '{"resumo": "Pix sem comprovante", "tags": []}'
            if "REALMENTE relevantes" in system:
                return '[{"number": "INC0000001", "relevant": true, "reason": "mesma causa"}]'
            if "INCIDENTE de verdade" in system:
                return '{"classification": "PROCEDENTE", "justification": "falha"}'
            return next(texts)

    class _Emb:
        def embed(self, text: str) -> list[float]:
            return [0.1, 0.2]

    class _Ret:
        def search(self, vector: list[float], *, top_k: int, query_filter: object = None):  # type: ignore[no-untyped-def]
            return [
                RetrievedHit(
                    number="INC0000001",
                    score=0.93,
                    payload={"short_description": "Pix pendente", "resolution_notes": "ok"},
                )
            ]

    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(  # type: ignore[attr-defined]
        llm=_Pipe(), embeddings=_Emb(), retriever=_Ret(), incidents=repo, notes=notes
    )
    client.app.dependency_overrides[get_incident_repository] = lambda: repo  # type: ignore[attr-defined]
    client.app.dependency_overrides[get_work_notes] = lambda: notes  # type: ignore[attr-defined]
    req = {"number": "INC0099999", "short_description": "Pix", "description": "x"}
    headers = {"X-Client-Id": "aluno-1"}
    first = client.post("/api/suggest", json=req, headers=headers).json()
    second = client.post("/api/suggest", json=req, headers=headers).json()
    assert first["publication"]["published"] and second["publication"]["published"]
    assert second["publication"]["note"]["id"] == first["publication"]["note"]["id"]
    (note,) = notes.list("INC0099999", client_id="aluno-1")
    assert note.text == "Reinicie o worker [INC0000001]."
    memory = client.app.state.analysis_store.get("aluno-1", "INC0099999")  # type: ignore[attr-defined]
    assert memory is not None
    assert memory.kept == ["INC0000001"]
    assert memory.suggestion == "Reinicie o worker [INC0000001]."
    assert memory.reasons == {"INC0000001": "mesma causa"}
