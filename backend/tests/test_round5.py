"""Auditoria de lógica, rodada 5 (bugs-logica-5.md).

A contradiction is now structural: it is between two named parts of the
Change, and a sentence that denies a contradiction never is one, however it
is phrased (P1-2). The follow-up knows which analysis the page shows (P2-2),
and a greeting offers only what that analysis has (P2-4).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from incident_sense.api.ask import get_ask_llm
from incident_sense.changes.evaluator import classify_point
from incident_sense.data.analyses import AnalysisMemory

# --- P1-2: the corpus, both ways -------------------------------------------------
DENIALS = [
    "Nenhuma contradição encontrada.",
    "Não há nenhuma contradição.",
    "Nenhuma contradição entre objetivo e plano.",
    "Nenhuma contradição encontrada entre objetivo, plano e retorno.",
    "Não foram identificadas contradições ou inconsistências.",
    "Não há inconsistências evidentes.",
    "Não há contradições: o plano cobre o objetivo.",
    "Não há contradições entre as partes do pedido.",
    "Sem contradições.",
    "Sem contradições entre implementação e retorno.",
    "Não encontrei contradições entre os campos.",
    "Não identifiquei nenhuma inconsistência entre objetivo e benefícios.",
    "Não foi encontrada nenhuma divergência relevante.",
    "Nenhum conflito entre o plano de implementação e o plano de retorno.",
    "Nenhuma inconsistência.",
    "**Nenhum problema identificado**",
    "Inexistem contradições entre as partes.",
    "Não houve contradição entre tarefas e retorno.",
    "Nada a apontar.",
    "Nada a declarar",
    "Tudo certo.",
    "N/A",
    "-",
    "nenhuma",
    "Não se aplica.",
]
REMARKS = [  # one part only: advice, not a contradiction
    "O plano de retorno poderia detalhar o tempo de cada passo.",
    "Faltam responsáveis no plano de validação.",
    "As partes contam a mesma história.",
    "O retorno não desfaz a migração de dados.",
]
CONTRADICTIONS = [
    "Nenhuma tarefa cobre o problema de certificado citado no objetivo.",
    "Sem retorno para a migração de dados que a implementação faz.",
    "Não foi previsto rollback do certificado que o plano troca.",
    "O retorno não desfaz a migração de dados que a implementação faz.",
    "O objetivo fala em 30 segundos e os benefícios em 9 minutos.",
    "A validação não testa o índice que a implementação cria.",
    "Não há retorno para a migração de dados que a implementação faz.",
    "As tarefas cadastradas trocam o certificado, mas o retorno só reinicia o pod.",
]


@pytest.mark.parametrize("text", DENIALS)
def test_a_denial_is_never_a_contradiction(text: str) -> None:
    assert classify_point(text)[0] == "none"


@pytest.mark.parametrize("text", REMARKS)
def test_a_remark_on_one_part_is_guidance(text: str) -> None:
    assert classify_point(text)[0] == "note"


@pytest.mark.parametrize("text", CONTRADICTIONS)
def test_a_real_contradiction_names_two_parts_and_counts(text: str) -> None:
    assert classify_point(text) == ("contradiction", text)


def test_the_structured_item_counts_by_its_two_parts() -> None:
    item = {"campos": ["retorno", "implementação"], "descricao": "O retorno não desfaz o índice."}
    assert classify_point(item) == ("contradiction", "O retorno não desfaz o índice.")
    one = {"campos": ["retorno"], "descricao": "O retorno poderia ser mais curto."}
    assert classify_point(one)[0] == "note"
    same = {"campos": ["retorno", "plano de retorno"], "descricao": "Falta o tempo."}
    assert classify_point(same)[0] == "note"
    polite = {"campos": ["objetivo", "plano"], "descricao": "Não há nenhuma contradição."}
    assert classify_point(polite)[0] == "none"


def _change_eval(client: TestClient, semantic: dict[str, Any]) -> dict[str, Any]:
    from test_changes_audit import _eval, _Scripted, _semantic, _wire

    _wire(client, _Scripted(_semantic(**semantic)))
    return _eval(client)


@pytest.mark.parametrize("text", DENIALS[:8])
def test_a_polite_list_keeps_pode_seguir(client: TestClient, text: str) -> None:
    body = _change_eval(client, {"consistency_score": 9.0, "problems": [text]})
    assert body["semantic"]["problems"] == []
    assert body["decision"]["passes"] is True


def test_remarks_move_to_the_guidance(client: TestClient) -> None:
    body = _change_eval(
        client,
        {
            "consistency_score": 9.0,
            "guidance": "Detalhe o horário.",
            "problems": ["Faltam responsáveis no plano de validação"],
        },
    )
    assert body["semantic"]["problems"] == []
    assert body["semantic"]["guidance"] == (
        "Detalhe o horário. Faltam responsáveis no plano de validação."
    )
    assert body["decision"]["passes"] is True


def test_the_prompt_asks_for_two_parts_and_an_empty_list() -> None:
    from incident_sense.changes.evaluator import _SEMANTIC_SYSTEM

    assert '"campos"' in _SEMANTIC_SYSTEM and "DUAS partes" in _SEMANTIC_SYSTEM
    assert '"problems": []' in _SEMANTIC_SYSTEM


def test_the_demo_replays_keep_their_verdicts(client: TestClient) -> None:
    """CHG0031001 stays "Pode seguir"; CHG0031002 keeps its one contradiction."""
    from incident_sense.api.changes import get_judge_factory

    sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
    import evaluation_fixture as fx

    verdicts = {}
    for number in ("CHG0031001", "CHG0031002"):
        client.app.dependency_overrides[get_judge_factory] = (  # type: ignore[attr-defined]
            lambda n=number: lambda _m: fx.StubJudge(n)
        )
        body = client.post(f"/api/changes/{number}/evaluate", json={}).json()
        verdicts[number] = (body["decision"]["passes"], len(body["semantic"]["problems"]))
    assert verdicts == {"CHG0031001": (True, 0), "CHG0031002": (False, 1)}


# --- P2-2 and P2-4: the follow-up and the analysis on screen ------------------------
class _LLM:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def complete(self, system: str, user: str, **_: object) -> str:
        self.calls.append(user)
        return json.dumps({"kind": "answer", "answer": "Expirar as sessões."})


def _remember(client: TestClient, **over: object) -> None:
    memory: dict[str, Any] = {
        "id": "analise-b",
        "classification": "PROCEDENTE",
        "justification": "Falha técnica.",
        "suggestion": "1. Expirar as sessões [PRB0004105].",
        "kept": ["PRB0004105"],
        **over,
    }
    client.app.state.analysis_store.put(  # type: ignore[attr-defined]
        "aluno-1", "INC0052233", AnalysisMemory.model_validate(memory)
    )


def _ask(client: TestClient, question: str, **body: object):
    return client.post(
        "/api/incidents/INC0052233/ask",
        json={"question": question, **body},
        headers={"X-Client-Id": "aluno-1"},
    )


def test_a_question_about_another_tabs_analysis_asks_to_resync(client: TestClient) -> None:
    _remember(client)
    llm = _LLM()
    client.app.dependency_overrides[get_ask_llm] = lambda: llm  # type: ignore[attr-defined]
    stale = _ask(client, "Qual é o primeiro passo?", analysis_id="analise-a")
    assert stale.status_code == 409
    assert llm.calls == []
    assert _ask(client, "Qual é o primeiro passo?", analysis_id="analise-b").status_code == 200
    # Older pages send no id: they get the stored analysis, as before.
    assert _ask(client, "Qual é o primeiro passo?").status_code == 200


def test_the_greeting_of_an_improcedente_offers_no_suggestion(client: TestClient) -> None:
    client.app.dependency_overrides[get_ask_llm] = _LLM  # type: ignore[attr-defined]
    _remember(client, classification="IMPROCEDENTE", suggestion=None, kept=[])
    hello = _ask(client, "oi").json()["answer"]
    assert "resolução sugerida" not in hello and "primeiro passo" not in hello
    assert "veredito" in hello
    _remember(client)
    assert "primeiro passo" in _ask(client, "oi").json()["answer"]
