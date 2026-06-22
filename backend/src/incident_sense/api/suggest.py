"""POST /api/suggest — the live RAG resolution-suggestion endpoint.

The RAG dependencies are provided through ``get_rag_deps`` so tests can override
them with fakes (``app.dependency_overrides``). Missing credentials yield a
clear 503 instead of a stack trace.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from incident_sense.config import get_settings
from incident_sense.models import SuggestRequest, SuggestResponse
from incident_sense.rag.clients import RagDeps, build_deps
from incident_sense.rag.pipeline import run_suggestion

router = APIRouter(tags=["suggest"])


def get_rag_deps() -> RagDeps:
    """Build the RAG dependencies, or fail clearly if keys are missing."""
    settings = get_settings()
    if not (settings.has_llm and settings.has_openai):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "API keys are not configured. Set OPENAI_API_KEY and "
                "OPENROUTER_API_KEY in your .env to use the live suggestion."
            ),
        )
    return build_deps(settings)


@router.post("/suggest", response_model=SuggestResponse)
def suggest(
    request: SuggestRequest, deps: Annotated[RagDeps, Depends(get_rag_deps)]
) -> SuggestResponse:
    """Classify a new incident and, if PROCEDENTE, suggest a grounded resolution."""
    return run_suggestion(request, deps, get_settings())
