"""Tests for the Problem browse endpoints + repository."""

from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from incident_sense.api.incidents import get_incident_repository
from incident_sense.api.problems import get_problem_repository
from incident_sense.data.loader import load_problems
from incident_sense.data.problem_repository import ProblemRepository
from incident_sense.data.repository import IncidentRepository
from incident_sense.models import (
    ClusterPoint,
    Impact,
    Incident,
    IncidentState,
    Priority,
    Problem,
    Urgency,
)


def _incident(number: str, day: int) -> Incident:
    return Incident(
        number=number,
        short_description=f"Pix lento {number}",
        description="timeout no DICT",
        category="Pagamentos",
        subcategory="Pix",
        cmdb_ci="PIX-Core",
        assignment_group="Sustentacao-Pagamentos",
        priority=Priority.HIGH,
        impact=Impact.HIGH,
        urgency=Urgency.HIGH,
        state=IncidentState.RESOLVED,
        opened_at=datetime(2026, 6, day, 10, 0),
        resolution_notes="corrigido",
    )


def _point(number: str, cluster_id: int, label: str, *, outlier: bool = False) -> ClusterPoint:
    return ClusterPoint(
        id=number,
        x=0.0,
        y=0.0,
        cluster_id=cluster_id,
        cluster_label=label,
        is_outlier=outlier,
        short_description="Pix lento",
        priority=2,
    )


def _problem(number: str, linked: list[str]) -> Problem:
    return Problem(
        number=number,
        short_description="Timeouts recorrentes no Pix",
        description="Picos esgotam o pool.",
        root_cause="Pool pequeno para o pico.",
        workaround="Aumentar os workers.",
        permanent_fix="Autoescalonamento do pool.",
        category="Pagamentos",
        subcategory="Pix",
        cmdb_ci="PIX-Core",
        assignment_group="Sustentacao-Pagamentos",
        state="Resolvido",
        opened_at=datetime(2026, 2, 3, 10, 0),
        linked_incidents=linked,
    )


def _incidents() -> IncidentRepository:
    return IncidentRepository(
        [_incident("INC1", 1), _incident("INC2", 2), _incident("INC3", 3)],
        {
            "INC1": _point("INC1", 1, "Timeout no Pix"),
            "INC2": _point("INC2", 1, "Timeout no Pix"),
            "INC3": _point("INC3", -1, "Casos isolados", outlier=True),
        },
    )


def _problems() -> ProblemRepository:
    return ProblemRepository(
        [_problem("PRB2", ["INC3"]), _problem("PRB1", ["INC1", "INC2", "INC3", "INC404"])]
    )


def test_repository_lists_in_number_order() -> None:
    summaries = _problems().list()
    assert [p.number for p in summaries] == ["PRB1", "PRB2"]
    assert summaries[0].linked_incidents == ["INC1", "INC2", "INC3", "INC404"]


def test_detail_joins_known_incidents_newest_first_and_the_main_cluster() -> None:
    detail = _problems().detail("prb1", _incidents())
    assert detail is not None
    assert [i.number for i in detail.related] == ["INC3", "INC2", "INC1"]
    assert detail.cluster_id == 1
    assert detail.cluster_label == "Timeout no Pix"


def test_detail_has_no_cluster_when_linked_incidents_are_outliers() -> None:
    detail = _problems().detail("PRB2", _incidents())
    assert detail is not None
    assert detail.cluster_id is None
    assert detail.cluster_label is None
    assert _problems().detail("PRB404", _incidents()) is None


def test_list_and_detail_endpoints(client: TestClient) -> None:
    client.app.dependency_overrides[get_problem_repository] = _problems
    client.app.dependency_overrides[get_incident_repository] = _incidents

    listed = client.get("/api/problems").json()
    assert [p["number"] for p in listed] == ["PRB1", "PRB2"]
    assert listed[0]["root_cause"] == "Pool pequeno para o pico."
    assert "workaround" not in listed[0]

    body = client.get("/api/problems/PRB1").json()
    assert body["root_cause"] == "Pool pequeno para o pico."
    assert body["workaround"] == "Aumentar os workers."
    assert body["empresa"] == "Banco Meridiano"
    assert [i["number"] for i in body["related"]] == ["INC3", "INC2", "INC1"]
    assert client.get("/api/problems/PRB404").status_code == 404


def test_committed_problems_link_to_committed_incidents(client: TestClient) -> None:
    problems = load_problems()
    assert [p.number for p in problems] == [f"PRB00041{i:02d}" for i in range(1, 11)]
    body = client.get("/api/problems/PRB0004101").json()
    assert len(body["related"]) == len(problems[0].linked_incidents)
    assert body["cluster_label"]
