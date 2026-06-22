"""Liveness + readiness endpoint.

Besides a simple "ok", it reports whether the LLM and embedding credentials are
configured. The frontend uses this to show a friendly message instead of a raw
error when keys are missing.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from incident_sense import __version__
from incident_sense.config import get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Basic service status plus credential availability flags."""

    status: str
    version: str
    llm_configured: bool
    embeddings_configured: bool


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Return service status and whether external providers are configured."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        version=__version__,
        llm_configured=settings.has_llm,
        embeddings_configured=settings.has_openai,
    )
