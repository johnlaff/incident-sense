"""Calibração ao vivo depois do #123: CHG0031001 saiu "Não segue" em 1 de 6.

A missing task, detail or owner is a gap, never a contradiction; the coherence
judgement runs three times in parallel and only a contradiction on the same
pair of parts in at least two runs blocks; and CHG0031001 says what every run
nitpicked.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from incident_sense.changes.evaluator import (
    _SEMANTIC_SYSTEM,
    _SemanticOut,
    aggregate_semantic,
    classify_point,
)
from test_changes_audit import _eval, _semantic, _wire

# The item that failed run #5 of the live calibration (typed contradicao).
RUN5 = (
    "O passo 1 e 2 do retorno não têm tarefa cadastrada para helm get values "
    "e para conferir as conexões no painel."
)
GAPS = [
    RUN5,
    "Nenhuma tarefa cobre o problema de certificado citado no objetivo.",
    "A tarefa de retorno não tem responsável definido, embora a implementação cite a DBA.",
    "O plano de validação não diz quem recebe o alerta das 4 horas da implementação.",
    "A implementação não detalha como o canário passa a 50%, e o retorno assume um release só.",
    "Falta no retorno a tarefa de conferir o pool que a implementação aumenta.",
]
REAL = Path(__file__).parent / "fixtures" / "real_eval"


@pytest.mark.parametrize("text", GAPS)
def test_a_missing_task_detail_or_owner_is_a_gap_even_when_typed_contradicao(text: str) -> None:
    item = {"tipo": "contradicao", "campos": ["retorno", "tarefas"], "descricao": text}
    assert classify_point(item)[0] == "attention"
    assert classify_point(text)[0] == "attention"


def test_a_real_contradiction_still_blocks() -> None:
    item = {
        "tipo": "contradicao",
        "campos": ["implementação", "retorno"],
        "descricao": "A implementação migra os dados e o retorno só volta a imagem.",
    }
    assert classify_point(item)[0] == "contradiction"


def test_the_prompt_says_a_missing_thing_is_always_a_gap() -> None:
    assert "SEMPRE" in _SEMANTIC_SYSTEM and "lacuna" in _SEMANTIC_SYSTEM
    for word in ("tarefa", "responsável", "detalhe"):
        assert word in _SEMANTIC_SYSTEM
    assert "fatos incompatíveis" in _SEMANTIC_SYSTEM


# --- three runs, aggregated -----------------------------------------------------
def _out(score: float, percent: int, problems: list[Any] | None = None) -> _SemanticOut:
    return _SemanticOut.model_validate(
        _semantic(
            consistency_score=score,
            backout_adherence_percent=percent,
            problems=problems or [],
        )
    ).settled()


CONTRA = {
    "tipo": "contradicao",
    "campos": ["implementação", "retorno"],
    "descricao": "A implementação migra os dados e o retorno só volta a imagem.",
}
OTHER = {
    "tipo": "contradicao",
    "campos": ["objetivo", "benefícios"],
    "descricao": "O objetivo fala em 30 segundos e os benefícios em 9 minutos.",
}


def test_scores_are_the_median() -> None:
    out = aggregate_semantic([_out(9.0, 92), _out(7.0, 70), _out(8.5, 88)])
    assert out.consistency_score == 8.5
    assert out.backout_adherence_percent == 88
    assert out.backout_adherence == "ADERENTE"


def test_a_contradiction_counts_only_in_two_of_three_runs() -> None:
    out = aggregate_semantic(
        [_out(7.0, 80, [CONTRA, OTHER]), _out(7.0, 80, [CONTRA]), _out(7.0, 80)]
    )
    assert out.problems == [CONTRA["descricao"]]
    assert OTHER["descricao"] in out.attention


def test_two_runs_must_agree_and_one_run_stands_alone() -> None:
    two = aggregate_semantic([_out(7.0, 80, [CONTRA]), _out(7.0, 80)])
    assert two.problems == [] and CONTRA["descricao"] in two.attention
    one = aggregate_semantic([_out(7.0, 80, [CONTRA])])
    assert one.problems == [CONTRA["descricao"]]


def test_run5_next_to_two_clean_runs_passes(client: TestClient) -> None:
    """The live case: two aligned runs and run #5 (7,0 and a typed item)."""
    a = json.loads((REAL / "CHG0031001_a.json").read_text(encoding="utf-8"))
    b = json.loads((REAL / "CHG0031001_b.json").read_text(encoding="utf-8"))
    run5 = {
        **a,
        "consistency_score": 7.0,
        "problems": [
            {
                "tipo": "contradicao",
                "campos": ["implementação", "retorno"],
                "descricao": "A implementação troca o chart e o retorno volta outra versão.",
            }
        ],
    }
    _wire(client, _Scripted3([a, b, run5]))
    body = _eval(client)
    assert body["decision"]["passes"] is True, body["decision"]
    assert body["semantic"]["consistency_score"] == 8.0
    assert body["semantic"]["problems"] == []


class _Scripted3:
    """Fields at 9,2; the semantic replies in turn, one per call."""

    def __init__(self, replies: list[Any], barrier: threading.Barrier | None = None) -> None:
        self.replies = replies
        self.barrier = barrier
        self.calls = 0
        self.semantic_calls = 0
        self._lock = threading.Lock()

    def complete(self, system: str, user: str, **_: object) -> str:
        with self._lock:
            self.calls += 1
        if "TAREFAS CADASTRADAS" not in user:
            return json.dumps({"score": 9.2, "diagnosis": "d", "guidance": ""})
        with self._lock:
            i = self.semantic_calls
            self.semantic_calls += 1
        if self.barrier is not None:
            self.barrier.wait()  # all three must be in flight at once
        reply = self.replies[i % len(self.replies)]
        if isinstance(reply, Exception):
            raise reply
        return json.dumps(reply)


def test_the_three_runs_go_in_parallel(client: TestClient) -> None:
    judge = _Scripted3([_semantic()], barrier=threading.Barrier(3, timeout=5))
    _wire(client, judge)
    body = _eval(client)
    assert judge.semantic_calls == 3
    assert body["model_calls"] == 10
    assert body["semantic"] is not None


def test_one_failed_run_degrades_to_the_other_two(client: TestClient) -> None:
    judge = _Scripted3([_semantic(), TimeoutError("lento"), _semantic(consistency_score=9.0)])
    _wire(client, judge)
    body = _eval(client)
    assert body["semantic"]["consistency_score"] == 8.5
    assert body["decision"]["passes"] is True


def test_all_runs_failing_is_semantic_missing(client: TestClient) -> None:
    _wire(client, _Scripted3([TimeoutError("lento")]))
    assert _eval(client)["decision"]["reason_code"] == "semantic_missing"


# --- the data -----------------------------------------------------------------
def _chg(number: str) -> dict[str, Any]:
    data = json.loads(
        (Path(__file__).parents[1] / "data" / "changes.json").read_text(encoding="utf-8")
    )
    items = data if isinstance(data, list) else data.get("changes", data.get("items", []))
    return next(c for c in items if c["number"] == number)


def test_chg0031001_says_what_every_run_nitpicked() -> None:
    c = _chg("CHG0031001")
    text = json.dumps(c, ensure_ascii=False).lower()
    tasks = json.dumps(c.get("tasks", c.get("change_tasks", [])), ensure_ascii=False).lower()
    assert "helm get values (pool 40, timeout 30s) e conexões no painel" in tasks
    assert "replicas" in c["implementation_plan"].lower()
    assert "alerta" in c["validation_plan"].lower()
    assert "fora da janela" in text
    backout = c["backout_plan"].lower()
    assert "snapshot" in backout and "contingência" in backout
    assert "não há restauração de dados" in backout


def test_the_demo_replays_keep_their_verdicts(client: TestClient) -> None:
    from incident_sense.api.changes import get_judge_factory

    sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
    import evaluation_fixture as fx

    verdicts = {}
    for number in ("CHG0031001", "CHG0031002"):
        client.app.dependency_overrides[get_judge_factory] = (  # type: ignore[attr-defined]
            lambda n=number: lambda _m: fx.StubJudge(n)
        )
        body = client.post(f"/api/changes/{number}/evaluate", json={}).json()
        verdicts[number] = body["decision"]["passes"]
    assert verdicts == {"CHG0031001": True, "CHG0031002": False}


def test_the_calibration_script_runs_in_parallel(monkeypatch: pytest.MonkeyPatch) -> None:
    sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
    import calibrar_mudanca

    barrier = threading.Barrier(3, timeout=5)
    seen: list[str] = []

    def fake(base: str, number: str, client_id: str, timeout: float) -> dict[str, Any]:
        seen.append(client_id)
        barrier.wait()  # three at once, or this times out
        return {"overall": 9.2, "decision": {"passes": True, "failed": []}, "semantic": None}

    monkeypatch.setattr(calibrar_mudanca, "evaluate", fake)
    assert calibrar_mudanca.main(["CHG0031001", "--vezes", "3", "--paralelo", "3"]) == 0
    assert len(set(seen)) == 3
