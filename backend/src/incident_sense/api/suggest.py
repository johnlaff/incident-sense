"""POST /api/suggest — the live RAG resolution-suggestion endpoint.

The RAG dependencies are provided through ``get_rag_deps`` so tests can override
them with fakes (``app.dependency_overrides``). Missing credentials yield a
clear 503 instead of a stack trace.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from incident_sense.config import get_settings, resolve_chat_model
from incident_sense.logging import get_logger
from incident_sense.models import SuggestRequest, SuggestResponse
from incident_sense.providers import make_chat_client
from incident_sense.rag.clients import OpenAILLMClient, RagDeps, build_deps
from incident_sense.rag.pipeline import run_suggestion

router = APIRouter(tags=["suggest"])
log = get_logger(__name__)


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
    """Classify a new incident and, if PROCEDENTE, suggest a grounded resolution.

    Infrastructure failures (vector store down, AI provider error) are turned
    into a clean, localized 502 so the UI can show a useful message and offer a
    retry. Deliberate ``HTTPException``s (e.g. the 503 from ``get_rag_deps``)
    pass through untouched; the true exception type is preserved in the log.
    """
    settings = get_settings()
    # Honor the model picked in the UI: swap only the chat client, reusing the
    # injected embeddings/retriever (so test fakes keep working when no model is
    # requested). Unknown ids resolve to the default, leaving deps untouched.
    chosen = resolve_chat_model(request.model, settings)
    if chosen != settings.llm_model:
        deps = replace(deps, llm=OpenAILLMClient(make_chat_client(settings), chosen))
    try:
        return run_suggestion(request, deps, settings)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the client.
        log.error("suggest_failed", error=str(exc), error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Não foi possível gerar a sugestão agora. Verifique se o Qdrant e os "
                "provedores de IA estão disponíveis e tente novamente."
            ),
        ) from exc
