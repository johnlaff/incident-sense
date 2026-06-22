"""Contract tests for the HTTP API surface."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    """/api/health returns a well-formed status payload."""
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    # Credential flags are always booleans, regardless of whether keys are set.
    assert isinstance(body["llm_configured"], bool)
    assert isinstance(body["embeddings_configured"], bool)


def test_openapi_schema_served(client: TestClient) -> None:
    """The OpenAPI schema is generated and lists the health route."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert "/api/health" in schema["paths"]
