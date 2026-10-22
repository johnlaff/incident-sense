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
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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
        embeddings_configured=settings.has_llm,
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


class BodySizeLimit:
    """Refuse a request body above ``max_bytes`` with 413, before anything parses it.

    A declared ``Content-Length`` is checked up front; a body without one is
    counted as it streams, so a chunked upload cannot slip past. Nothing the
    site sends is more than a few kilobytes, and an oversized body would only
    ever be a way to spend memory or model tokens.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Serve the request, or answer 413 once the body passes the limit."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = _content_length(scope)
        if declared is not None and declared > self.max_bytes:
            await _too_large(send)
            return
        received = 0
        refused = False

        async def bounded_receive() -> Message:
            nonlocal received, refused
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    refused = True
                    # Starlette's request parser surfaces this as a client
                    # disconnect; the response below is what the client sees.
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            if refused:
                return
            await send(message)

        await self.app(scope, bounded_receive, guarded_send)
        if refused:
            await _too_large(send)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", []):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _too_large(send: Send) -> None:
    body = (
        '{"detail": "O pedido é grande demais para a demo. Encurte o texto e tente de novo."}'
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


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

    # Outermost: nothing reads a body bigger than the demo ever sends.
    app.add_middleware(BodySizeLimit, max_bytes=settings.max_body_bytes)
    # The browser frontend is served from a different origin; allow just that one.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    return app


app = create_app()
