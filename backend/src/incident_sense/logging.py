"""Structured logging setup, built on structlog.

Why structured logs: each entry is a dict of key/value pairs, so logs stay
greppable locally (pretty console) and machine-parseable in production (JSON).

Security: never pass secrets (API keys, tokens) as event fields. Log *that* a
provider was called, not the credentials used to call it.
"""

from __future__ import annotations

import logging
from typing import cast

import structlog


def configure_logging(level: str = "INFO", *, json_logs: bool = False) -> None:
    """Configure structlog process-wide.

    Args:
        level: minimum level name (e.g. ``"INFO"``, ``"DEBUG"``).
        json_logs: render JSON (production) instead of the colored console
            output used during local development.
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    # Processors run in order on every log call, enriching the event dict before
    # it is rendered. contextvars let us bind request-scoped fields once.
    shared_processors: list[structlog.typing.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    renderer: structlog.typing.Processor = (
        structlog.processors.JSONRenderer() if json_logs else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[*shared_processors, renderer],
        # Drop log calls below the configured level cheaply.
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.typing.FilteringBoundLogger:
    """Return a bound logger; pass ``__name__`` from the calling module."""
    # structlog.get_logger is typed as returning Any; narrow it to the logger
    # type our configuration actually produces.
    return cast(structlog.typing.FilteringBoundLogger, structlog.get_logger(name))
