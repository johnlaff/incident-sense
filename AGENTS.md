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
    api/               routers: health, incidents, problems, suggest, clusters, changes
    rag/               clients (DI protocols), postfilter, pipeline
    clustering/        (clustering output is served from committed JSON)
    data/              archetypes, loader, ingest, precomputed (de)serialization
  scripts/             generate_dataset.py, precompute.py, ingest.py
  data/                COMMITTED incidents.json, problems.json + precomputed/
  tests/               pytest (LLM/embeddings/Qdrant mocked)
contracts/             Shared SSE protocol fixtures read by both pytest and Vitest
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
- The suggestion flow follows the seven steps of João's article (load, AI
  summary, embedding of summary + categoria/subcategoria/empresa, three-layer
  retrieval, context, procedência gate, suggestion with validated sources,
  publication as a work note). See `docs/rag-flow.md` and ADR 0016.
- Classification answers "is this a real incident?" (not "is there a base?"):
  `IMPROCEDENTE` = self-service/non-incident; a real incident with no similar
  case is `PROCEDENTE` with no suggestion. See `rag/pipeline.py:classify_with_reason`.
- Retrieval floor/top-K are settings (`RETRIEVAL_MIN_SIMILARITY` 0.8,
  `INCIDENT_TOP_K` 5, `PROBLEM_TOP_K` 10). Problems (`data/problems.json`) live
  in their own Qdrant collection; without `problem_embeddings.npz` each one sits
  at the mean vector of its linked incidents.
- The Aurora model picker is real: `POST /api/suggest` takes a `model` id mapped
  to a real OpenRouter model via `SELECTABLE_MODELS` (`config.py`); unknown ids
  fall back to the default.
