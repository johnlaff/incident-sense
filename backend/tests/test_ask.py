"""POST /api/incidents/{number}/ask: a follow-up question about an analysis.

E2E round 3 P1-2: the chat ignored what the person typed and re-ran the whole
suggestion (spending credit and publishing another note). A follow-up is now
one model call, grounded only on the incident and the cases the analysis kept,
and it never publishes.
"""

from __future__ import annotations

import json

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from incident_sense.api.ask import get_ask_llm
from incident_sense.data.work_notes import get_work_notes_store
from incident_sense.guard import UsageGuard, get_usage_guard

_REQ = httpx.Request("POST", "https://ia.example")
KEPT = ["INC0052219", "PRB0004105"]


class _LLM:
    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str, **_: object) -> str:
        self.calls.append((system, user))
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def _wire(client: TestClient, reply: str | Exception) -> _LLM:
    llm = _LLM(reply)
    client.app.dependency_overrides[get_ask_llm] = lambda: llm  # type: ignore[attr-defined]
    return llm


def _ask(client: TestClient, question: str, context_ids: list[str] | None = None, **kw: object):
    return client.post(
        "/api/incidents/INC0052233/ask",
        json={"question": question, "context_ids": KEPT if context_ids is None else context_ids},
        headers={"X-Client-Id": "aluno-1"},
        **kw,  # type: ignore[arg-type]
    )


def _reply(kind: str, answer: str) -> str:
    return json.dumps({"kind": kind, "answer": answer}, ensure_ascii=False)


def test_answers_the_question_with_citations_only_from_kept_cases(client: TestClient) -> None:
    llm = _wire(
        client,
        _reply(
            "answer",
            "Expire as sessões antigas [PRB0004105] e reverta a validação do token "
            "[INC0052219]. Veja também [INC0099999].",
        ),
    )
    r = _ask(client, "Como eu resolvo isso rápido?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "answer"
    assert body["citations"]["cited"] == ["PRB0004105", "INC0052219"]
    assert [f["id"] for f in body["citations"]["flagged"]] == ["INC0099999"]
    assert "INC0099999" not in body["answer"]
    # One call, grounded on the incident and the kept cases only.
    assert len(llm.calls) == 1
    system, user = llm.calls[0]
    assert "Como eu resolvo isso rápido?" in user
    assert "INC0052233" in user and "Sustentacao-Canais-Digitais" in user
    assert "[INC0052219]" in user and "[PRB0004105]" in user
    assert "validação do token" in user  # the kept incident's resolution
    assert "INC0052228" not in user  # retrieved elsewhere, not sent: not in this context


def test_a_follow_up_never_publishes_a_note(client: TestClient) -> None:
    _wire(client, _reply("answer", "Expire as sessões [PRB0004105]."))
    store = get_work_notes_store()
    before = len(store.list("INC0052233", client_id="aluno-1"))
    r = _ask(client, "E depois?")
    assert r.status_code == 200
    assert "publication" not in r.json()
    assert len(store.list("INC0052233", client_id="aluno-1")) == before


def test_the_incident_itself_answers_priority_and_owner(client: TestClient) -> None:
    llm = _wire(
        client,
        _reply("answer", "Prioridade 1, com o grupo Sustentacao-Canais-Digitais (INC0052233)."),
    )
    body = _ask(client, "Qual é a prioridade e quem está cuidando?").json()
    assert "fora das fontes" not in body["answer"]  # its own number is not a stray citation
    assert body["citations"]["cited"] == []
    assert "Prioridade: 1" in llm.calls[0][1]


@pytest.mark.parametrize("hello", ["oi", "Olá!", "bom dia", "obrigado", "valeu", "?"])
def test_greetings_get_a_short_reply_without_a_model_call(client: TestClient, hello: str) -> None:
    llm = _wire(client, _reply("answer", "não deveria ser chamado"))
    body = _ask(client, hello).json()
    assert body["kind"] == "off_topic"
    assert "INC0052233" in body["answer"]
    assert llm.calls == []


def test_off_topic_and_unanswerable_are_said_plainly(client: TestClient) -> None:
    _wire(client, _reply("off_topic", "Só respondo sobre o INC0052233 e os casos da análise."))
    assert _ask(client, "Quem ganhou o jogo ontem?").json()["kind"] == "off_topic"
    _wire(client, _reply("not_in_cases", "Os casos não dizem quanto tempo leva."))
    body = _ask(client, "Quanto tempo leva?").json()
    assert body["kind"] == "not_in_cases"
    assert body["citations"]["cited"] == []


def test_prompt_asks_to_say_when_the_cases_do_not_answer(client: TestClient) -> None:
    llm = _wire(client, _reply("answer", "ok"))
    _ask(client, "Por quê?")
    system = llm.calls[0][0]
    assert "not_in_cases" in system and "off_topic" in system
    assert "SOMENTE" in system


def test_prose_instead_of_json_is_still_an_answer(client: TestClient) -> None:
    _wire(client, "Expire as sessões antigas [PRB0004105].")
    body = _ask(client, "Como resolvo?").json()
    assert body["kind"] == "answer"
    assert body["citations"]["cited"] == ["PRB0004105"]


def test_unknown_or_unresolved_ids_are_not_context(client: TestClient) -> None:
    llm = _wire(client, _reply("answer", "Veja [INC0052233] e [PRB9999999]."))
    body = _ask(client, "E aí, como resolvo?", ["PRB9999999", "INC0052233", "NAOEID"]).json()
    assert body["context_ids"] == []
    assert body["citations"]["cited"] == []
    assert "[PRB9999999]" not in llm.calls[0][1]


def test_unknown_incident_is_404(client: TestClient) -> None:
    _wire(client, _reply("answer", "x"))
    r = client.post("/api/incidents/INC0000001/ask", json={"question": "x", "context_ids": []})
    assert r.status_code == 404


@pytest.mark.parametrize(
    ("error", "status", "said"),
    [
        (openai.APITimeoutError(request=_REQ), 504, "demorou demais"),
        (
            openai.RateLimitError("quota", response=httpx.Response(429, request=_REQ), body=None),
            503,
            "sem cota",
        ),
        (RuntimeError("boom"), 502, "Não foi possível responder"),
    ],
)
def test_errors_have_their_own_copy(
    client: TestClient, error: Exception, status: int, said: str
) -> None:
    _wire(client, error)
    r = _ask(client, "Como resolvo?")
    assert r.status_code == status
    assert said in r.json()["detail"]


def test_follow_ups_are_rate_limited_like_suggest(client: TestClient) -> None:
    class _Full(UsageGuard):
        def check(self, **_: object) -> str | None:  # type: ignore[override]
            return "Você fez muitas análises seguidas. Espere alguns minutos."

    client.app.dependency_overrides[get_usage_guard] = lambda: _Full()  # type: ignore[attr-defined]
    llm = _wire(client, _reply("answer", "x"))
    r = _ask(client, "Como resolvo?")
    assert r.status_code == 429
    assert llm.calls == []


def test_question_length_is_bounded(client: TestClient) -> None:
    _wire(client, _reply("answer", "x"))
    assert _ask(client, "").status_code == 422
    assert _ask(client, "a" * 601).status_code == 422
