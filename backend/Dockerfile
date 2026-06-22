# syntax=docker/dockerfile:1
# Multi-stage build for the FastAPI backend, using uv. The runtime stage runs as
# a non-root user and contains only what the API needs (no clustering extras).

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Install runtime dependencies first (cached unless the lockfile changes).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Then install the project itself.
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR=/app/data \
    PYTHONUNBUFFERED=1

# Copy the built virtualenv and the application from the builder stage.
COPY --from=builder /app /app

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "incident_sense.main:app", "--host", "0.0.0.0", "--port", "8000"]
