# AGENTS.md

Concise map and conventions for coding agents (and humans in a hurry).

## What this is

`incident-sense`: a live demo for presentations and classes, an ITSM-style
workspace for a **fictional** bank's IT ops with three capabilities: an LLM judge that grades Change requests (before the
deploy), RAG resolution suggestion with follow-up questions (after the deploy)
and recurrence detection (clustering). All data is synthetic; the bank ("Banco
Meridiano") is fictional.

Live: site https://incident-sense.joaoaraxaiba.workers.dev (Cloudflare Workers),
API https://incident-sense-api.onrender.com (Render Free).

## Repo map

```
backend/
  src/incident_sense/
    config.py          pydantic-settings (env-driven config, SELECTABLE_MODELS)
    logging.py         structlog setup
    providers.py       OpenRouter clients (20 s timeout, no retries) + JSON helpers
    guard.py           usage guard (per client/IP/day, IP = last trusted hop of
                       X-Forwarded-For, bounded memory) + client_key() (X-Client-Id)
    prompts.py         UNTRUSTED_INPUT_NOTICE appended to every system prompt
    main.py            FastAPI app (64 KB body limit, CORS, lifespan self-seeds Qdrant)
    models/            pydantic schemas (incident, suggest, ask, change, problem, cluster, work_note, copilot_stream)
    api/               routers: health, incidents, ask, problems, suggest, clusters, changes
    rag/               clients (DI protocols), tags, postfilter, pipeline (7 steps)
    changes/           evaluator (LLM judge + decide()), rubric, rubrica.toml, repository
    clustering/        (clustering output is served from committed JSON)
    data/              archetypes, loader, ingest, precomputed, reembed, work_notes
  scripts/             generate_dataset.py, precompute.py, reembed.py, ingest.py, evaluation_fixture.py
  data/                COMMITTED incidents.json, problems.json, changes.json + precomputed/
  tests/               pytest (LLM/embeddings/Qdrant mocked)
contracts/             Shared SSE protocol fixtures read by both pytest and Vitest
frontend/              Next.js 16 (App Router) + TS + Tailwind v4 + regl-scatterplot + react-markdown
  app/                 incidentes, recorrencias (menu "Repetições"; /repeticoes redirects),
                       problemas, changes, como-funciona, aula
  components/          app-shell, assistant-fab ("Perguntar à IA"), pipeline-trace, aula, concepts
  lib/                 api (X-Client-Id, 90 s AI timeout), followup (ask), changes, models, aula-machine
  wrangler.jsonc       Cloudflare Workers via OpenNext (npm run cf:deploy)
render.yaml            Render Blueprint for the API (Qdrant ":memory:")
keep-awake/            Cloudflare Worker with a cron trigger: pings the API every 10 min
.github/workflows/     backend-ci, frontend-ci, backend-deploy (hook + backup ping),
                       frontend-deploy (Cloudflare), keep-awake-deploy,
                       release (tag -> GitHub Release + GHCR)
docs/                  PT-BR docs, diagrams/ (Mermaid sources) + decisions/ (ADRs)
```

## Commands

Use the Makefile (runs backend via `uv`, frontend via `npm`):

- `make check`: lint + typecheck + test (both stacks); must pass.
- `make lint` / `make fmt` / `make typecheck` / `make test`
- `make up`: full stack via Docker Compose
- `make generate` / `make precompute`: regenerate data (need a key); `make seed`
  loads committed vectors into a Qdrant server (no key)
- Frontend formatting: `cd frontend && npx prettier --check .`

Backend directly: `cd backend && uv run pytest|ruff check .|mypy src`.

## Conventions

- **Code, comments, docstrings: English.** Docs/README: **Portuguese (pt-BR)**.
- Python: type hints everywhere, `mypy --strict` clean, `ruff` clean, pydantic v2.
- TypeScript: `strict`, no `any`.
- **Dependency injection** for LLM/embedding/vector clients (mockable; see
  `rag/clients.py` and the tests).
- Conventional Commits. **No AI attribution anywhere** (commits, docs, comments).
- Copy and docs: PT-BR, no em dashes, only the fictional "Banco Meridiano".
  Sources are cited as references: (Ferreira, 2026) and (Freitas Neto, 2026);
  never by first name, and never with an event or talk name.
- Secrets only in `.env` (gitignored); `.env.example` holds placeholders.
- The committed `data/` artifacts are the source of truth; the clustering view is
  served offline from them.

## Gotchas

- Heavy clustering deps (`bertopic`/`umap`/`hdbscan`) are an **optional extra**
  (`uv sync --all-extras`); the API runtime and tests don't need them.
- The chat provider (OpenRouter default) may not support JSON mode; structured
  output is done via prompted JSON + pydantic validation.
- The suggestion flow follows the seven steps of the reference pipeline (Ferreira, 2026) (load, AI
  summary, embedding of summary + categoria/subcategoria/empresa, three-layer
  retrieval, context, procedência gate, suggestion with validated sources,
  publication as a work note). See `docs/rag-flow.md` and ADR 0016.
- Classification answers "is this a real incident?" (not "is there a base?"):
  `IMPROCEDENTE` = self-service/non-incident; a real incident with no similar
  case is `PROCEDENTE` with no suggestion. See `rag/pipeline.py:classify_with_reason`.
- Retrieval floor/top-K are settings (`RETRIEVAL_MIN_SIMILARITY` 0.8,
  `INCIDENT_TOP_K` 5, `PROBLEM_TOP_K` 10). Problems (`data/problems.json`) live
  in their own Qdrant collection. The RAG collection is seeded from
  `summary_embeddings.npz` (summary + fields, as in the reference) and Problems
  from `problem_embeddings.npz`; `embeddings.npz` (raw text) only feeds
  clustering. The post-filter reads title, description and resolution.
- The model picker is real: `POST /api/suggest`, `/ask` and
  `/changes/{n}/evaluate` take a `model` id mapped to a real OpenRouter model
  via `SELECTABLE_MODELS` (`config.py`); unknown ids fall back to the default
  (`anthropic/claude-haiku-5.5`). Every chat call sends `reasoning.enabled=false`.
- The UI calls the assistant "Assistente da IA". Its old name, Aurora, survives
  only in internal identifiers (`AURORA` in `lib/model.ts`, the `"aurora"`
  lesson id); do not show it in copy.
- Follow-ups: the first assistant question is `/api/suggest`; later ones are
  `POST /api/incidents/{n}/ask`, grounded only on the analysis' kept
  `context_ids`, never publishing a note (ADR 0021).
- Change verdict: `decide()` in `changes/evaluator.py` returns `decision`
  `{passes, reason_code, failed, reason}`; gates are average >= 8.0,
  consistency >= 8.0, no real contradiction, backout not `NAO_ADERENTE`
  (< 50%); a field without a score yields `field_missing`. The frontend reads
  only `decision`, never re-derives it (ADR 0019).
- Per-visitor state: `client_key()` (X-Client-Id, first 64 chars, or the IP)
  keys the quota, the Change content lock and the published work notes
  (ADR 0020). All of it is in memory and resets on restart.
- The demo is public (ADR 0023): the per-network quota uses the hop a trusted
  proxy appended to `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1), never
  the first one; every text sent to a model has a `max_length` (description
  4000, Change field 6000, question 600); bodies over 64 KB get 413; every
  system prompt ends with `UNTRUSTED_INPUT_NOTICE`. Keep all four when adding
  an AI route.
- `frontend/tests/evaluation-fixture.json` is generated by
  `backend/scripts/evaluation_fixture.py`; do not edit it by hand.
