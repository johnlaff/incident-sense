# AGENTS.md

Concise map and conventions for coding agents (and humans in a hurry).

## What this is

`incident-sense` — a local, portfolio-grade demo with two capabilities for a
**fictional** bank's IT ops: RAG resolution suggestion and recurrence detection
(clustering). All data is synthetic; the bank ("Banco Meridiano") is fictional.

## Repo map

```
backend/
  src/incident_sense/
    config.py          pydantic-settings (env-driven config)
    logging.py         structlog setup
    providers.py       OpenAI/OpenRouter clients + JSON extraction helpers
    main.py            FastAPI app (CORS, lifespan self-seeds Qdrant)
    models/            pydantic schemas (incident, suggest, cluster)
    api/               routers: health, suggest, clusters
    rag/               clients (DI protocols), postfilter, pipeline
    clustering/        (clustering output is served from committed JSON)
    data/              archetypes, loader, ingest, precomputed (de)serialization
  scripts/             generate_dataset.py, precompute.py, ingest.py
  data/                COMMITTED incidents.json + precomputed/ (embeddings, clusters)
  tests/               pytest (LLM/embeddings/Qdrant mocked)
frontend/              Next.js (App Router) + TS + Tailwind + regl-scatterplot
                       + react-markdown (Aurora's suggestion is rendered markdown)
docs/                  PT-BR docs + decisions/ (ADRs)
```

## Commands

Use the Makefile (runs backend via `uv`, frontend via `npm`):

- `make check` — lint + typecheck + test (both stacks); must pass.
- `make lint` / `make fmt` / `make typecheck` / `make test`
- `make up` — full stack via Docker Compose
- `make generate` / `make precompute` / `make seed` — regenerate data (need keys)

Backend directly: `cd backend && uv run pytest|ruff check .|mypy src`.

## Conventions

- **Code, comments, docstrings: English.** Docs/README: **Portuguese (pt-BR)**.
- Python: type hints everywhere, `mypy --strict` clean, `ruff` clean, pydantic v2.
- TypeScript: `strict`, no `any`.
- **Dependency injection** for LLM/embedding/vector clients (mockable; see
  `rag/clients.py` and the tests).
- Conventional Commits. **No AI attribution anywhere** (commits, docs, comments).
- Secrets only in `.env` (gitignored); `.env.example` holds placeholders.
- The committed `data/` artifacts are the source of truth; the clustering view is
  served offline from them.

## Gotchas

- Heavy clustering deps (`bertopic`/`umap`/`hdbscan`) are an **optional extra**
  (`uv sync --all-extras`); the API runtime and tests don't need them.
- The chat provider (OpenRouter default) may not support JSON mode; structured
  output is done via prompted JSON + pydantic validation.
- Classification answers "is this a real incident?" (not "is there a base?"):
  `IMPROCEDENTE` = self-service/non-incident; a real incident with no similar
  case is `PROCEDENTE` with no suggestion. See `rag/pipeline.py:classify`.
- The Aurora model picker is real: `POST /api/suggest` takes a `model` id mapped
  to a real OpenRouter model via `SELECTABLE_MODELS` (`config.py`); unknown ids
  fall back to the default.
