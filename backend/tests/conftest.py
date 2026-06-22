"""Shared pytest fixtures.

Tests are hermetic: they never call real LLM/embedding/Qdrant services. The
``client`` fixture builds the FastAPI app against a fresh settings instance.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from incident_sense.config import get_settings
from incident_sense.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient bound to a freshly built app."""
    # Settings are cached process-wide; clear so each test sees current env.
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
