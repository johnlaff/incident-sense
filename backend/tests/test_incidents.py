"""Tests for the incident browse endpoints + repository."""

from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from incident_sense.api.incidents import get_incident_repository
from incident_sense.data.repository import IncidentRepository
from incident_sense.models import (
    ClusterPoint,
    Impact,
    Incident,
    IncidentState,
    Priority,
    Urgency,
)
from incident_sense.models.incident_list import IncidentDetail


def _incident(number: str, *, state: IncidentState, cmdb_ci: str, short: str) -> Incident:
    resolved = state in (IncidentState.RESOLVED, IncidentState.CLOSED)
    return Incident(
        number=number,
        short_description=short,
        description=f"descrição de {short}",
        category="Pagamentos",
        subcategory="Pix",
        cmdb_ci=cmdb_ci,
        assignment_group="Sustentacao-Pagamentos",
        priority=Priority.HIGH,
        impact=Impact.HIGH,
        urgency=Urgency.HIGH,
        state=state,
        opened_at=datetime(2026, 6, 1, 10, 0),
        resolution_notes="corrigido" if resolved else None,
    )


def _repo() -> IncidentRepository:
    return IncidentRepository(
        [
            _incident("INC1", state=IncidentState.NEW, cmdb_ci="PIX-Core", short="Pix lento"),
            _incident(
                "INC2", state=IncidentState.RESOLVED, cmdb_ci="PIX-Core", short="Pix timeout"
            ),
            _incident(
                "INC3", state=IncidentState.CLOSED, cmdb_ci="Boleto-Service", short="Boleto erro"
            ),
        ]
    )


def test_repository_filters_by_state_group() -> None:
    repo = _repo()
    assert repo.list(state_group="open").total == 1
    assert repo.list(state_group="resolved").total == 2
    assert repo.list(state_group="all").total == 3
    assert repo.list().open_count == 1
    assert repo.list().resolved_count == 2


def test_repository_filters_by_service_and_query() -> None:
    repo = _repo()
    assert {i.number for i in repo.list(service="PIX-Core").items} == {"INC1", "INC2"}
    assert [i.number for i in repo.list(query="boleto").items] == ["INC3"]


def test_list_endpoint(client: TestClient) -> None:
    client.app.dependency_overrides[get_incident_repository] = _repo
    body = client.get("/api/incidents?state=resolved").json()
    assert body["total"] == 2
    assert body["resolved_count"] == 2
    assert "PIX-Core" in body["services"]


def test_detail_endpoint_and_404(client: TestClient) -> None:
    client.app.dependency_overrides[get_incident_repository] = _repo
    ok = client.get("/api/incidents/INC2")
    assert ok.status_code == 200
    body = ok.json()
    assert body["resolution_notes"] == "corrigido"
    # Detail always carries the cluster fields; null when no clustering is joined.
    assert body["cluster_id"] is None
    assert body["cluster_label"] is None
    assert client.get("/api/incidents/NOPE").status_code == 404


def test_detail_joins_cluster_when_present() -> None:
    point = ClusterPoint(
        id="INC2",
        x=1.0,
        y=2.0,
        cluster_id=3,
        cluster_label="Timeout no Pix",
        is_outlier=False,
        short_description="Pix timeout",
        priority=2,
    )
    repo = IncidentRepository(
        [_incident("INC2", state=IncidentState.RESOLVED, cmdb_ci="PIX-Core", short="Pix timeout")],
        {"INC2": point},
    )
    detail = IncidentDetail.from_incident(repo.get("INC2"), repo.get_cluster("INC2"))
    assert detail.cluster_id == 3
    assert detail.cluster_label == "Timeout no Pix"
    assert detail.is_outlier is False
