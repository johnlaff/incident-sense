"""FastAPI application entrypoint.

Run locally with::

    uv run uvicorn incident_sense.main:app --reload

CORS is restricted to the configured frontend origin. The ``lifespan`` hook is
where startup work (logging setup, and later self-seeding Qdrant) happens.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from incident_sense import __version__
from incident_sense.api import api_router
from incident_sense.config import get_settings
from incident_sense.logging import configure_logging, get_logger


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown lifecycle.

    Self-seeding Qdrant from the committed embeddings is wired in here once the
    ingestion module exists; for now it just records lifecycle events.
    """
    settings = get_settings()
    log = get_logger(__name__)
    log.info(
        "startup",
        version=__version__,
        qdrant_url=settings.qdrant_url,
        llm_configured=settings.has_llm,
        embeddings_configured=settings.has_openai,
    )
    if settings.auto_seed:
        # Seed Qdrant from the committed embeddings (no API calls). Imported
        # lazily so the app and tests don't pull in the vector store unless
        # seeding actually runs. Runs in a thread to avoid blocking the loop.
        from incident_sense.data.ingest import ensure_seeded

        seeded = await asyncio.to_thread(ensure_seeded, settings)
        log.info("seed_complete", points=seeded)
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.log_json)

    app = FastAPI(
        title="incident-sense",
        version=__version__,
        summary="Resolution suggestion (RAG) and recurrence detection (clustering).",
        lifespan=lifespan,
    )

    # The browser frontend is served from a different origin; allow just that one.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    return app


app = create_app()
