"""Contract tests for the HTTP API surface (no network)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from incident_sense.api.clusters import get_clusters
from incident_sense.api.suggest import get_rag_deps
from incident_sense.config import get_settings
from incident_sense.main import create_app
from incident_sense.models import ClusterPoint, ClustersResponse, ClusterSummary
from incident_sense.rag.clients import RagDeps, RetrievedHit


# --- fakes for endpoint dependency overrides ---------------------------------
class _FakeLLM:
    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        return "consulta" if "consulta de busca" in system else ""


class _FakeEmbeddings:
    def embed(self, text: str) -> list[float]:
        return [0.0, 0.0, 0.0]


class _FakeRetriever:
    def search(
        self, vector: list[float], *, top_k: int, query_filter: object | None = None
    ) -> list[RetrievedHit]:
        return []


# --- health ------------------------------------------------------------------
def test_health_ok(client: TestClient) -> None:
    """/api/health returns a well-formed status payload."""
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert isinstance(body["llm_configured"], bool)
    assert isinstance(body["embeddings_configured"], bool)


def test_openapi_schema_served(client: TestClient) -> None:
    """The OpenAPI schema lists the three routes."""
    schema = client.get("/openapi.json").json()
    for path in ("/api/health", "/api/clusters", "/api/suggest"):
        assert path in schema["paths"]


# --- clusters ----------------------------------------------------------------
def test_clusters_endpoint_serves_injected_data(client: TestClient) -> None:
    sample = ClustersResponse(
        points=[
            ClusterPoint(
                id="INC1",
                x=1.0,
                y=2.0,
                cluster_id=0,
                cluster_label="Timeout no Pix",
                is_outlier=False,
                short_description="Pix lento",
                priority=2,
            )
        ],
        clusters=[ClusterSummary(cluster_id=0, label="Timeout no Pix", size=1)],
        total=1,
        outliers=0,
    )
    client.app.dependency_overrides[get_clusters] = lambda: sample

    body = client.get("/api/clusters").json()
    assert body["total"] == 1
    assert body["points"][0]["id"] == "INC1"
    assert body["clusters"][0]["label"] == "Timeout no Pix"


# --- suggest -----------------------------------------------------------------
def test_suggest_endpoint_contract_with_fake_deps(client: TestClient) -> None:
    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(
        llm=_FakeLLM(), embeddings=_FakeEmbeddings(), retriever=_FakeRetriever()
    )
    response = client.post(
        "/api/suggest",
        json={"short_description": "Pix sem comprovante", "description": "Detalhes."},
    )

    assert response.status_code == 200
    body = response.json()
    # No retrieved candidates -> IMPROCEDENTE with no suggestion.
    assert body["classification"] == "IMPROCEDENTE"
    assert body["suggestion"] is None
    assert body["candidates"] == []


def test_suggest_missing_keys_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTO_SEED", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/suggest",
            json={"short_description": "x", "description": "y"},
        )
    get_settings.cache_clear()

    assert response.status_code == 503
    assert "key" in response.json()["detail"].lower()
