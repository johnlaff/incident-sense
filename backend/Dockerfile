# syntax=docker/dockerfile:1
# Multi-stage build for the FastAPI backend, using uv. The runtime stage runs as
# a non-root user and contains only what the API needs (no clustering extras,
# no uv, no build tools).

FROM python:3.14-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Install runtime dependencies first (cached unless the lockfile changes). The
# cache mount keeps uv's wheel cache across builds without bloating the image.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Then install the project itself (data is committed and baked into the image).
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.14-slim AS runtime
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR=/app/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy the built virtualenv and the application from the builder stage.
COPY --from=builder /app /app

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=20s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]

LABEL org.opencontainers.image.source="https://github.com/johnlaff/incident-sense" \
      org.opencontainers.image.description="incident-sense API (RAG suggestion + recurrence clustering)" \
      org.opencontainers.image.licenses="MIT"

CMD ["uvicorn", "incident_sense.main:app", "--host", "0.0.0.0", "--port", "8000"]
