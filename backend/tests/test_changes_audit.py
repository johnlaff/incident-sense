"""Audit of 21/10/2026: the verdict is decided once, here, and off-schema model
replies are normalized instead of failing the whole evaluation."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from incident_sense.api.changes import (
    get_change_repository,
    get_evaluation_cache,
    get_judge_factory,
)
from incident_sense.changes.evaluator import EvaluationCache
from incident_sense.changes.repository import ChangeRepository
from incident_sense.changes.rubric import load_rubric
from incident_sense.config import Settings
from incident_sense.providers import make_chat_client
from test_changes import _change

_BY_LABEL = {f.label: f.key for f in load_rubric().fields}


class _Scripted:
    """Field replies by key (or one for all) and a semantic reply, as raw text."""

    def __init__(
        self,
        semantic: dict[str, Any] | str | list[str] | None,
        field: float | str | dict[str, Any] = 9.2,
    ) -> None:
        self.semantic = semantic
        self.field = field
        self.calls = 0
        self.semantic_calls = 0

    def complete(self, system: str, user: str, **_: object) -> str:
        self.calls += 1
        if "TAREFAS CADASTRADAS" in user:
            self.semantic_calls += 1
            s = self.semantic
            if isinstance(s, list):
                return s[min(self.semantic_calls, len(s)) - 1]
            return s if isinstance(s, str) else json.dumps(s)
        key = _BY_LABEL[user.split("CAMPO AVALIADO: ", 1)[1].split("\n", 1)[0].strip()]
        f = self.field
        score = f.get(key, 9.2) if isinstance(f, dict) else f
        if isinstance(score, list):
            return score.pop(0)
        return json.dumps({"score": score, "diagnosis": f"diag {key}", "guidance": ""})


def _semantic(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "consistency_score": 8.0,
        "problems": [],
        "reasoning": "As partes contam a mesma história.",
        "guidance": "",
        "backout_adherence": "ADERENTE",
        "backout_adherence_percent": 90,
    }
    base.update(over)
    return base


def _wire(client: TestClient, judge: _Scripted, cache: EvaluationCache | None = None) -> None:
    repo = ChangeRepository([_change("CHG1")])
    shared = cache or EvaluationCache()
    client.app.dependency_overrides[get_change_repository] = lambda: repo
    client.app.dependency_overrides[get_evaluation_cache] = lambda: shared
    client.app.dependency_overrides[get_judge_factory] = lambda: lambda _model: judge


def _eval(client: TestClient, client_id: str = "visitante-1", **body: Any) -> dict[str, Any]:
    r = client.post("/api/changes/CHG1/evaluate", json=body, headers={"X-Client-Id": client_id})
    assert r.status_code == 200, r.text
    return r.json()


# ----- One decision, computed once -------------------------------------------


def test_suggestions_do_not_hold_back_a_coherent_change(client: TestClient) -> None:
    sem = _semantic(problems=["Poderia citar o indicador.", "Poderia dar o tempo."])
    _wire(client, _Scripted(sem))
    body = _eval(client)
    assert body["decision"]["passes"] is True
    assert body["decision"]["reason_code"] == "passes"


def test_low_coherence_with_no_points_does_not_pass(client: TestClient) -> None:
    """P0-1: 3,0 and Não aderente 10% next to "Pode seguir"."""
    sem = _semantic(
        consistency_score=3.0, backout_adherence="NAO_ADERENTE", backout_adherence_percent=10
    )
    _wire(client, _Scripted(sem))
    body = _eval(client)
    assert body["decision"]["passes"] is False
    assert body["decision"]["reason_code"] == "coherence_below"


def test_backout_not_adherent_holds_back_even_with_high_coherence(client: TestClient) -> None:
    sem = _semantic(
        consistency_score=9.0, backout_adherence="NAO_ADERENTE", backout_adherence_percent=20
    )
    _wire(client, _Scripted(sem))
    body = _eval(client)
    assert body["decision"] == {
        "passes": False,
        "reason_code": "backout_not_adherent",
        "reason": body["decision"]["reason"],
    }


def test_average_below_cut_never_passes(client: TestClient) -> None:
    _wire(client, _Scripted(_semantic(), field=3.0))
    body = _eval(client)
    assert body["semantic"] is None
    assert body["decision"]["passes"] is False
    assert body["decision"]["reason_code"] == "average_below"


def test_coherence_is_rounded_before_the_cut(client: TestClient) -> None:
    """P1-5: 7,96 shows as 8,0, so it must also count as 8,0."""
    _wire(client, _Scripted(_semantic(consistency_score=7.96)))
    body = _eval(client)
    assert body["semantic"]["consistency_score"] == 8.0
    assert body["decision"]["passes"] is True


def test_adherence_label_follows_the_percent(client: TestClient) -> None:
    """P1-5: "Aderente" with 20% and "Parcial" with 100% never reach the screen."""
    _wire(client, _Scripted(_semantic(backout_adherence="ADERENTE", backout_adherence_percent=20)))
    assert _eval(client)["semantic"]["backout_adherence"] == "NAO_ADERENTE"


def test_full_coverage_reads_adherent(client: TestClient) -> None:
    _wire(client, _Scripted(_semantic(backout_adherence="PARCIAL", backout_adherence_percent=100)))
    assert _eval(client)["semantic"]["backout_adherence"] == "ADERENTE"


# ----- Off-schema replies -----------------------------------------------------


def test_adherence_with_accent_is_normalized(client: TestClient) -> None:
    sem = _semantic(backout_adherence="NÃO_ADERENTE", backout_adherence_percent=30)
    _wire(client, _Scripted(sem))
    assert _eval(client)["semantic"]["backout_adherence"] == "NAO_ADERENTE"


@pytest.mark.parametrize(("raw", "expected"), [("8,5", 8.5), (85, 8.5), ("9", 9.0)])
def test_field_score_comma_or_percent_scale_is_normalized(
    client: TestClient, raw: object, expected: float
) -> None:
    _wire(client, _Scripted(_semantic(), field=raw))  # type: ignore[arg-type]
    body = _eval(client)
    assert {f["score"] for f in body["fields"]} == {expected}


def test_semantic_that_never_parses_degrades_only_the_semantic(client: TestClient) -> None:
    judge = _Scripted("isto não é json")
    _wire(client, judge)
    body = _eval(client)
    assert body["overall"] == 9.2
    assert body["semantic"] is None
    assert body["semantic_skipped_reason"]
    assert body["decision"]["passes"] is False
    assert body["decision"]["reason_code"] == "semantic_missing"


def test_points_are_deduplicated_and_plain(client: TestClient) -> None:
    """P2-1, P2-3: duplicates, empties and markdown never reach the list."""
    sem = _semantic(
        problems=["**Plano de retorno** não reverte", "**Plano de retorno** não reverte", " "]
    )
    _wire(client, _Scripted(sem))
    assert _eval(client)["semantic"]["problems"] == ["Plano de retorno não reverte"]


def test_repair_attempt_is_counted(client: TestClient) -> None:
    """P2-6: the cost line counts every model call, the repair included."""
    good = json.dumps(_semantic())
    judge = _Scripted(["{quebrado", good])
    _wire(client, judge)
    body = _eval(client)
    assert body["model_calls"] == judge.calls == 9


# ----- Content lock per visitor (P0-2) -----------------------------------------


def test_a_new_visitor_never_sees_reused(client: TestClient) -> None:
    cache = EvaluationCache()
    judge = _Scripted(_semantic())
    _wire(client, judge, cache)
    _eval(client, client_id="ana")
    body = _eval(client, client_id="bia")
    assert body["model_calls"] == 8
    assert not any(f["reused"] for f in body["fields"])
    assert body["semantic"]["reused"] is False


def test_the_same_visitor_still_reuses_unchanged_fields(client: TestClient) -> None:
    cache = EvaluationCache()
    _wire(client, _Scripted(_semantic()), cache)
    _eval(client, client_id="ana")
    body = _eval(client, client_id="ana")
    assert body["model_calls"] == 0
    assert all(f["reused"] for f in body["fields"])


# ----- Words the audience reads -----------------------------------------------


def test_unknown_change_is_a_mudanca_in_portuguese(client: TestClient) -> None:
    """P2-7."""
    _wire(client, _Scripted(_semantic()))
    r = client.get("/api/changes/CHG9999999")
    assert r.status_code == 404
    assert r.json()["detail"] == "Mudança CHG9999999 não encontrada."


def test_skip_reason_names_the_lowest_field(client: TestClient) -> None:
    """P2-18: 7,99 with six fields at 8,0 is not "campo vazio ou vago"."""
    grades = dict.fromkeys(_BY_LABEL.values(), 8.0)
    grades["prerequisites"] = 7.8
    _wire(client, _Scripted(_semantic(), field=grades))
    body = _eval(client)
    assert body["semantic"] is None
    reason = body["semantic_skipped_reason"]
    assert reason.startswith(f"Nota {body['overall']:.2f} abaixo de 8.0")
    assert "Pré-requisitos" in reason
    assert "vazio ou vago" not in reason


# ----- Timeouts (P1-14) -------------------------------------------------------


def test_chat_client_has_a_short_timeout_and_one_retry() -> None:
    client = make_chat_client(Settings(openrouter_api_key="sk-test"))
    assert client.timeout == 30
    assert client.max_retries == 1
