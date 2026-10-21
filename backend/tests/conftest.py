"""Shared pytest fixtures.

Tests are hermetic: they never call real LLM/embedding/Qdrant services. The
``client`` fixture builds the FastAPI app against a fresh settings instance.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from incident_sense.config import get_settings
from incident_sense.data.analyses import AnalysisStore, get_analysis_store
from incident_sense.guard import UsageGuard, get_ask_guard, get_usage_guard
from incident_sense.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A TestClient bound to a freshly built app.

    Auto-seeding is disabled so tests never try to reach Qdrant.
    """
    monkeypatch.setenv("AUTO_SEED", "false")
    # Settings are cached process-wide; clear so each test sees current env.
    get_settings.cache_clear()
    app = create_app()
    # A fresh usage guard per test, so quotas never leak between tests.
    guard = UsageGuard()
    app.dependency_overrides[get_usage_guard] = lambda: guard
    # Follow-up questions have their own budget, also fresh per test.
    ask_guard = UsageGuard()
    app.dependency_overrides[get_ask_guard] = lambda: ask_guard
    # Each visitor's last analysis, as the server remembers it for /ask.
    analyses = AnalysisStore()
    app.state.analysis_store = analyses
    app.dependency_overrides[get_analysis_store] = lambda: analyses
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()
