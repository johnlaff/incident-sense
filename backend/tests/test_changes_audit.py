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


# ----- Audit round 2 (logica-2) -----------------------------------------------


def test_a_real_contradiction_holds_back_even_with_high_coherence(client: TestClient) -> None:
    """P1-N3: "Pode seguir" next to a contradiction listed as "não impedem"."""
    sem = _semantic(
        consistency_score=9.0,
        problems=["O plano de retorno não reverte a migração de dados que a implementação faz"],
    )
    _wire(client, _Scripted(sem))
    body = _eval(client)
    assert body["decision"]["passes"] is False
    assert body["decision"]["reason_code"] == "contradictions"
    assert "contradição" in body["decision"]["reason"]


def test_suggestions_in_guidance_never_hold_back(client: TestClient) -> None:
    sem = _semantic(guidance="Poderia citar o indicador de sucesso.")
    _wire(client, _Scripted(sem))
    assert _eval(client)["decision"]["reason_code"] == "passes"


def test_backout_reason_names_the_percent_and_the_cut(client: TestClient) -> None:
    """P1-N1: the failing gate is the backout, not the coherence."""
    sem = _semantic(consistency_score=8.5, backout_adherence_percent=45)
    _wire(client, _Scripted(sem))
    decision = _eval(client)["decision"]
    assert decision["reason_code"] == "backout_not_adherent"
    assert "45%" in decision["reason"]
    assert "50%" in decision["reason"]
    assert "tarefas" in decision["reason"]


def test_semantic_prompt_states_the_adherence_cuts() -> None:
    """P1-N1: the label follows the percent; the prompt says by which rule."""
    from incident_sense.changes.evaluator import _semantic_prompt

    prompt = _semantic_prompt(_change("CHG1"), dict.fromkeys(_BY_LABEL.values(), "x"), "volta")
    assert "80" in prompt and "50" in prompt
    assert '"backout_adherence"' not in prompt


@pytest.mark.parametrize(
    "over",
    [
        {"backout_adherence": "PARCIALMENTE_ADERENTE", "backout_adherence_percent": 60},
        {"problems": None},
        {"reasoning": None, "guidance": None},
        {"consistency_score": "8/10"},
        {"backout_adherence": None},
    ],
)
def test_near_schema_semantic_is_read(client: TestClient, over: dict[str, Any]) -> None:
    """P1-N5: what the backend can read must not become "semantic_missing"."""
    _wire(client, _Scripted(_semantic(**over)))
    body = _eval(client)
    assert body["semantic"] is not None, body["semantic_skipped_reason"]
    assert body["decision"]["reason_code"] != "semantic_missing"


def test_a_single_problem_string_becomes_a_list(client: TestClient) -> None:
    _wire(client, _Scripted(_semantic(problems="O retorno não desfaz o índice")))
    assert _eval(client)["semantic"]["problems"] == ["O retorno não desfaz o índice"]


def test_one_unreadable_field_degrades_only_that_field(client: TestClient) -> None:
    """P1-R1: one field that fails twice no longer 502s the whole evaluation."""
    judge = _Scripted(_semantic(), field={"objective": ["não sei avaliar", "não sei avaliar"]})
    _wire(client, judge)
    body = _eval(client)
    objective = next(f for f in body["fields"] if f["key"] == "objective")
    assert objective["score"] is None
    assert objective["failed"] is True
    assert "não conseguiu avaliar" in objective["diagnosis"]
    others = [f for f in body["fields"] if f["key"] != "objective"]
    assert all(f["score"] == 9.2 and not f["failed"] for f in others)
    assert body["decision"]["passes"] is False
    assert body["decision"]["reason_code"] == "field_missing"
    assert "Objetivo" in body["decision"]["reason"]
    assert body["semantic"] is None


def test_a_failed_field_is_not_locked(client: TestClient) -> None:
    """The next attempt asks the model again for the field that failed."""
    cache = EvaluationCache()
    good = json.dumps({"score": 9.2, "diagnosis": "ok", "guidance": ""})
    judge = _Scripted(_semantic(), field={"objective": ["?", "?", good]})
    _wire(client, judge, cache)
    _eval(client, client_id="ana")
    body = _eval(client, client_id="ana")
    objective = next(f for f in body["fields"] if f["key"] == "objective")
    assert objective["failed"] is False
    assert objective["reused"] is False


def test_every_field_failing_is_still_an_error(client: TestClient) -> None:
    _wire(client, _Scripted(_semantic(), field="nada"))
    r = client.post("/api/changes/CHG1/evaluate", json={}, headers={"X-Client-Id": "x"})
    assert r.status_code == 502


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("9/10", 9.0), ("9.0 (bom)", 9.0), (10.5, 10.0), (10, 10.0), (85, 8.5), (11, 1.1)],
)
def test_more_score_spellings_are_read(client: TestClient, raw: object, expected: float) -> None:
    """P1-R1 and P2-N10: 10,5 used to become 1,1."""
    _wire(client, _Scripted(_semantic(), field=raw))  # type: ignore[arg-type]
    assert {f["score"] for f in _eval(client)["fields"]} == {expected}


def test_missing_diagnosis_is_not_a_failure(client: TestClient) -> None:
    _wire(client, _Scripted(_semantic(), field={"objective": ['{"score": 9}']}))
    objective = next(f for f in _eval(client)["fields"] if f["key"] == "objective")
    assert objective["score"] == 9.0
    assert objective["failed"] is False


@pytest.mark.parametrize(("raw", "expected"), [(10.5, 10.0), ("8/10", 8.0)])
def test_coherence_spellings(client: TestClient, raw: object, expected: float) -> None:
    _wire(client, _Scripted(_semantic(consistency_score=raw)))
    assert _eval(client)["semantic"]["consistency_score"] == expected


def test_fraction_percent_is_read_as_percent(client: TestClient) -> None:
    """P2-N10: 0.8 used to become 1%."""
    _wire(client, _Scripted(_semantic(backout_adherence_percent=0.8)))
    sem = _eval(client)["semantic"]
    assert sem["backout_adherence_percent"] == 80
    assert sem["backout_adherence"] == "ADERENTE"


def test_fresh_bypasses_the_content_lock(client: TestClient) -> None:
    """P1-N4: a rehearsal in the same browser never freezes the live demo."""
    cache = EvaluationCache()
    judge = _Scripted(_semantic())
    _wire(client, judge, cache)
    _eval(client, client_id="ana")
    body = _eval(client, client_id="ana", fresh=True)
    assert body["model_calls"] == 8
    assert not any(f["reused"] for f in body["fields"])
    assert body["semantic"]["reused"] is False
    # The fresh reading is stored: a plain re-evaluation reuses it.
    assert _eval(client, client_id="ana")["model_calls"] == 0


def test_long_client_id_is_truncated_like_the_guard(client: TestClient) -> None:
    """P2-N13: 65 characters used to give 422 while the quota accepted it."""
    _wire(client, _Scripted(_semantic()))
    r = client.post("/api/changes/CHG1/evaluate", json={}, headers={"X-Client-Id": "a" * 65})
    assert r.status_code == 200, r.text


def test_server_deadline_fits_under_the_front_timeout() -> None:
    """P2-N9: field + repair + coherence + repair must end before the 90 s front."""
    client = make_chat_client(Settings(openrouter_api_key="sk-test"))
    assert client.max_retries == 0
    assert client.timeout * 4 < 90
