import json
from datetime import datetime
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
from incident_sense.config import get_settings
from incident_sense.models.change import Change, ChangeTask


def _change(number: str, **overrides: Any) -> Change:
    base: dict[str, Any] = {
        "number": number,
        "type": "Normal",
        "state": "New",
        "company": "Banco Meridiano",
        "cmdb_ci": "PIX-Core",
        "assignment_group": "Pagamentos-N2",
        "risk": "Moderado",
        "requested_by": "Ana Souza",
        "planned_start": datetime(2026, 10, 25, 1, 0),
        "planned_end": datetime(2026, 10, 25, 3, 0),
        "short_description": "Atualizar PIX-Core para 4.2.1",
        "objective": "Corrigir vazamento de conexões no PIX-Core.",
        "benefits": "Menos timeouts no Pix.",
        "prerequisites": "Backup do banco.",
        "implementation_plan": "1. Parar tráfego\n2. Implantar 4.2.1",
        "validation_plan": "Acompanhar taxa de erro por 30 min.",
        "test_justification": "Testado em homologação.",
        "backout_plan": "Voltar a imagem 4.2.0.",
        "tasks": [ChangeTask(number="CTASK1", short_description="Implantar 4.2.1")],
    }
    base.update(overrides)
    return Change(**base)


class _Judge:
    """Scores every field with a fixed note; records each call."""

    def __init__(self, field_score: float, consistency: float = 6.0) -> None:
        self.field_score = field_score
        self.consistency = consistency
        self.calls: list[str] = []

    def complete(self, system: str, user: str, **_: object) -> str:
        self.calls.append(user)
        if "TAREFAS CADASTRADAS" in user:
            return json.dumps(
                {
                    "consistency_score": self.consistency,
                    "problems": ["O retorno não desfaz a migração de dados."],
                    "reasoning": "A implementação altera dados; o retorno só troca imagem.",
                    "guidance": "Inclua a reversão da migração.",
                    "backout_adherence": "PARCIAL",
                    "backout_adherence_percent": 50,
                }
            )
        return json.dumps({"score": self.field_score, "diagnosis": "ok", "guidance": ""})


@pytest.fixture
def wired(client: TestClient) -> tuple[TestClient, _Judge]:
    judge = _Judge(field_score=9.0)
    repo = ChangeRepository(
        [
            _change("CHG1"),
            _change("CHG2", type="Standard"),
            _change("CHG3", company="Meridiano Seguros"),
        ]
    )
    cache = EvaluationCache()
    client.app.dependency_overrides[get_change_repository] = lambda: repo
    client.app.dependency_overrides[get_evaluation_cache] = lambda: cache
    client.app.dependency_overrides[get_judge_factory] = lambda: lambda _model: judge
    return client, judge


def test_rubric_weights_match_the_published_grid() -> None:
    rubric = load_rubric()
    weights = {f.key: f.weight for f in rubric.fields}
    assert weights == {
        "implementation_plan": 2.5,
        "validation_plan": 2.5,
        "objective": 2.0,
        "benefits": 2.0,
        "test_justification": 2.0,
        "short_description": 1.5,
        "prerequisites": 1.0,
    }
    assert rubric.total_weight == 13.5
    assert rubric.eligibility_threshold == 8.0


def test_one_call_per_field_then_semantic_when_eligible(wired: tuple[TestClient, _Judge]) -> None:
    client, judge = wired
    body = client.post("/api/changes/CHG1/evaluate", json={}).json()
    assert [f["key"] for f in body["fields"]][0] == "implementation_plan"
    assert body["overall"] == 9.0
    assert body["semantic"]["backout_adherence"] == "PARCIAL"
    assert body["semantic_skipped_reason"] is None
    assert body["model_calls"] == 8 == len(judge.calls)


def test_content_lock_only_resends_the_edited_field(wired: tuple[TestClient, _Judge]) -> None:
    client, judge = wired
    client.post("/api/changes/CHG1/evaluate", json={})
    judge.calls.clear()
    body = client.post(
        "/api/changes/CHG1/evaluate",
        json={"fields": {"benefits": "Reduz em 30% os timeouts do Pix no horário de pico."}},
    ).json()
    reused = {f["key"]: f["reused"] for f in body["fields"]}
    assert reused["benefits"] is False
    assert sum(not r for r in reused.values()) == 1
    # One field call plus a fresh semantic analysis (one input changed).
    assert body["model_calls"] == 2 == len(judge.calls)


def test_whitespace_only_edit_keeps_the_lock(wired: tuple[TestClient, _Judge]) -> None:
    client, judge = wired
    client.post("/api/changes/CHG1/evaluate", json={})
    judge.calls.clear()
    body = client.post(
        "/api/changes/CHG1/evaluate",
        json={"fields": {"benefits": "  Menos   timeouts no Pix.  "}},
    ).json()
    assert body["model_calls"] == 0
    assert body["semantic"]["reused"] is True


def test_below_threshold_skips_semantic(client: TestClient) -> None:
    judge = _Judge(field_score=5.0)
    client.app.dependency_overrides[get_change_repository] = lambda: ChangeRepository(
        [_change("CHG1")]
    )
    client.app.dependency_overrides[get_evaluation_cache] = EvaluationCache
    client.app.dependency_overrides[get_judge_factory] = lambda: lambda _model: judge
    body = client.post("/api/changes/CHG1/evaluate", json={}).json()
    assert body["overall"] == 5.0
    assert body["semantic"] is None
    assert "8.0" in body["semantic_skipped_reason"]
    assert len(judge.calls) == 7


def test_out_of_scope_is_not_evaluated_and_never_zero(wired: tuple[TestClient, _Judge]) -> None:
    client, judge = wired
    for number, word in (("CHG2", "Standard"), ("CHG3", "Meridiano Seguros")):
        body = client.post(f"/api/changes/{number}/evaluate", json={}).json()
        assert body["scope"]["in_scope"] is False
        assert word in body["scope"]["reason"]
        assert body["overall"] is None
        assert body["fields"] == []
    assert judge.calls == []


def test_list_and_detail(wired: tuple[TestClient, _Judge]) -> None:
    client, _ = wired
    listed = client.get("/api/changes").json()
    assert {c["number"]: c["in_scope"] for c in listed} == {
        "CHG1": True,
        "CHG2": False,
        "CHG3": False,
    }
    assert client.get("/api/changes/CHG1").json()["backout_plan"] == "Voltar a imagem 4.2.0."
    assert client.get("/api/changes/NOPE").status_code == 404


def test_evaluate_without_key_returns_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    get_settings.cache_clear()
    client.app.dependency_overrides[get_change_repository] = lambda: ChangeRepository(
        [_change("CHG1")]
    )
    response = client.post("/api/changes/CHG1/evaluate", json={})
    assert response.status_code == 503


def test_truncated_semantic_reply_is_retried_once(client: TestClient) -> None:
    class _Truncating(_Judge):
        def __init__(self) -> None:
            super().__init__(field_score=9.0)
            self.semantic_calls = 0

        def complete(self, system: str, user: str, **kw: object) -> str:
            if "TAREFAS CADASTRADAS" in user:
                self.semantic_calls += 1
                if self.semantic_calls == 1:
                    return '{"consistency_score": 6, "problems": ["O retorno não desf'
            return super().complete(system, user, **kw)

    judge = _Truncating()
    client.app.dependency_overrides[get_change_repository] = lambda: ChangeRepository(
        [_change("CHG1")]
    )
    client.app.dependency_overrides[get_evaluation_cache] = EvaluationCache
    client.app.dependency_overrides[get_judge_factory] = lambda: lambda _model: judge

    response = client.post("/api/changes/CHG1/evaluate", json={})

    assert response.status_code == 200
    assert response.json()["semantic"]["backout_adherence"] == "PARCIAL"
    assert judge.semantic_calls == 2
