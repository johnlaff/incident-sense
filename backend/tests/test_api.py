"""Contract tests for the HTTP API surface (no network)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from incident_sense.api.clusters import get_clusters
from incident_sense.api.suggest import get_rag_deps
from incident_sense.config import SELECTABLE_MODELS, get_settings, resolve_chat_model
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
    # No retrieved candidates and an unreadable classification: treated as a real
    # incident (never sent to self-service by a parse failure), with no suggestion.
    assert body["classification"] == "PROCEDENTE"
    assert body["suggestion"] is None
    assert body["candidates"] == []


def test_resolve_chat_model_uses_allowlist_else_default() -> None:
    settings = get_settings()
    # A known UI id maps to its real OpenRouter model...
    assert resolve_chat_model("claude-haiku", settings) == "anthropic/claude-haiku-5.5"
    assert resolve_chat_model("gpt-luna", settings) == SELECTABLE_MODELS["gpt-luna"]
    # ...and None or an unknown id falls back to the configured default.
    assert resolve_chat_model(None, settings) == settings.llm_model
    assert resolve_chat_model("totally-unknown", settings) == settings.llm_model


def test_suggest_accepts_model_field_with_fake_deps(client: TestClient) -> None:
    # The optional model field is accepted; with the default model resolved (the
    # fake LLM stays in place) the contract is unchanged.
    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(
        llm=_FakeLLM(), embeddings=_FakeEmbeddings(), retriever=_FakeRetriever()
    )
    response = client.post(
        "/api/suggest",
        json={
            "short_description": "Pix sem comprovante",
            "description": "Detalhes.",
            "model": "this-id-is-not-in-the-allowlist",
        },
    )
    assert response.status_code == 200
    assert response.json()["classification"] == "PROCEDENTE"


def test_suggest_missing_keys_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTO_SEED", "false")
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


def test_suggest_over_quota_returns_429_without_calling_the_model(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AI_MAX_PER_CLIENT", "1")
    get_settings.cache_clear()
    calls: list[str] = []

    class _CountingLLM(_FakeLLM):
        def complete(self, system: str, user: str, **_: object) -> str:
            calls.append(system)
            return super().complete(system, user)

    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(
        llm=_CountingLLM(), embeddings=_FakeEmbeddings(), retriever=_FakeRetriever()
    )
    body = {"short_description": "Pix fora", "description": "Erro 500."}
    headers = {"X-Client-Id": "plateia-1"}
    assert client.post("/api/suggest", json=body, headers=headers).status_code == 200
    made = len(calls)
    refused = client.post("/api/suggest", json=body, headers=headers)
    assert refused.status_code == 429
    assert len(calls) == made


def test_suggest_publishes_on_the_incident_work_notes(client: TestClient) -> None:
    """End to end: the suggestion shows up on GET /api/incidents/{number}."""
    from incident_sense.api.incidents import get_incident_repository, get_work_notes
    from incident_sense.data.repository import IncidentRepository
    from incident_sense.data.work_notes import WorkNotesStore
    from incident_sense.models import Incident

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
            "tags": ["pix"],
        }
    )
    repo = IncidentRepository([incident])
    store = WorkNotesStore()

    class _LLM:
        def complete(self, system: str, user: str, **_: object) -> str:
            if "consulta de busca" in system:
                return '{"resumo": "Pix sem comprovante", "tags": ["pix"]}'
            if "REALMENTE relevantes" in system:
                return '[{"number": "INC0000001", "relevant": true, "reason": "mesma causa"}]'
            if "INCIDENTE de verdade" in system:
                return '{"classification": "PROCEDENTE", "justification": "falha"}'
            return "Reprocesse a conciliação [INC0000001] [INC0000404]."

    class _Retriever:
        def search(self, vector: list[float], *, top_k: int, query_filter: object = None):  # type: ignore[no-untyped-def]
            hit = RetrievedHit(
                number="INC0000001",
                score=0.93,
                payload={"short_description": "Pix pendente", "resolution_notes": "ok"},
            )
            return [hit]

    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(
        llm=_LLM(),
        embeddings=_FakeEmbeddings(),
        retriever=_Retriever(),
        incidents=repo,
        notes=store,
    )
    client.app.dependency_overrides[get_incident_repository] = lambda: repo
    client.app.dependency_overrides[get_work_notes] = lambda: store

    body = client.post(
        "/api/suggest",
        json={
            "number": "INC0099999",
            "short_description": "Pix sem comprovante",
            "description": "Valor debitado.",
        },
    ).json()
    assert [s["id"] for s in body["steps"]] == [
        "carregar",
        "resumir",
        "embedding",
        "recuperar",
        "contexto",
        "decidir",
        "sugerir",
        "publicar",
    ]
    assert body["citations"]["flagged"] == [{"id": "INC0000404", "action": "removida"}]
    assert body["publication"]["published"] is True

    detail = client.get("/api/incidents/INC0099999").json()
    (note,) = detail["published_notes"]
    assert note["text"] == body["suggestion"] == "Reprocesse a conciliação [INC0000001]."


def test_suggest_timeout_is_a_504_that_says_so(client: TestClient) -> None:
    """logica-3 P2-11: a slow provider is not the generic 502."""
    import httpx
    import openai

    class _SlowLLM(_FakeLLM):
        def complete(self, system: str, user: str, **_: object) -> str:
            raise openai.APITimeoutError(request=httpx.Request("POST", "https://ia.example"))

    client.app.dependency_overrides[get_rag_deps] = lambda: RagDeps(
        llm=_SlowLLM(), embeddings=_FakeEmbeddings(), retriever=_FakeRetriever()
    )
    response = client.post("/api/suggest", json={"short_description": "x", "description": "y"})
    assert response.status_code == 504
    assert "demorou demais" in response.json()["detail"]
