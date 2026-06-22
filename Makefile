# =============================================================================
# incident-sense — predictable commands for humans and coding agents.
#
# Backend tasks run through `uv` (in ./backend); frontend tasks through `npm`
# (in ./frontend). Run `make` or `make help` to list everything.
# =============================================================================

.DEFAULT_GOAL := help
SHELL := /usr/bin/env bash

# --- Meta --------------------------------------------------------------------
.PHONY: help
help: ## Show this help.
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Setup & lifecycle -------------------------------------------------------
.PHONY: setup
setup: ## Install backend (uv) and frontend (npm) dependencies.
	cd backend && uv sync --all-extras
	cd frontend && npm install

.PHONY: up
up: ## Start the whole stack (qdrant + api + web) with Docker Compose.
	docker compose up --build

.PHONY: down
down: ## Stop the stack and remove containers.
	docker compose down

.PHONY: seed
seed: ## Load the committed dataset + embeddings into Qdrant (no API calls).
	cd backend && uv run python scripts/ingest.py

.PHONY: generate
generate: ## Regenerate the synthetic dataset (LLM calls; overwrites incidents.json).
	cd backend && uv run python scripts/generate_dataset.py

.PHONY: precompute
precompute: ## Recompute embeddings + clustering + labels (LLM/embedding calls).
	cd backend && uv run python scripts/precompute.py

# --- Local dev servers (outside Docker) --------------------------------------
.PHONY: api
api: ## Run the backend API with autoreload on :8000.
	cd backend && uv run uvicorn incident_sense.main:app --reload --port 8000

.PHONY: web
web: ## Run the frontend dev server on :3000.
	cd frontend && npm run dev

# --- Quality gates -----------------------------------------------------------
.PHONY: lint
lint: ## Lint backend (ruff) and frontend (eslint).
	cd backend && uv run ruff check .
	cd backend && uv run ruff format --check .
	cd frontend && npm run lint

.PHONY: fmt
fmt: ## Auto-format backend (ruff) and frontend (prettier).
	cd backend && uv run ruff format .
	cd backend && uv run ruff check --fix .
	cd frontend && npm run format

.PHONY: typecheck
typecheck: ## Type-check backend (mypy) and frontend (tsc).
	cd backend && uv run mypy src
	cd frontend && npm run typecheck

.PHONY: test
test: ## Run backend (pytest) and frontend (vitest) tests.
	cd backend && uv run pytest
	cd frontend && npm run test

.PHONY: check
check: lint typecheck test ## Run all quality gates (lint + typecheck + test).
