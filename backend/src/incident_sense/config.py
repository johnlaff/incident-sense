"""Application configuration (12-factor, read from the environment).

All tunables live here so the rest of the code never reads ``os.environ``
directly. Values come from environment variables (and a local ``.env`` during
development); secrets are never hard-coded.

The retrieval parameters (cosine floor 0.8, top-K 5 for incidents and 10 for
Problems) are the public values from João's article on the bank's pipeline.
They are configuration, not constants: precision and coverage are product
decisions.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/incident_sense/config.py -> parents[2] == backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Strongly-typed settings loaded from the environment.

    Field names map to upper-case environment variables (``llm_model`` reads
    ``LLM_MODEL``). A root ``.env`` is loaded in development; in Docker the same
    variables are injected by Compose.
    """

    model_config = SettingsConfigDict(
        # Absolute paths so the app finds .env whether started from ./backend or
        # the repo root: prefer a backend-local .env, fall back to the root one.
        env_file=(
            _BACKEND_ROOT / ".env",
            _BACKEND_ROOT.parent / ".env",
        ),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- LLM / embedding providers -------------------------------------------
    # Chat and embeddings both go through one OpenAI-compatible gateway that
    # defaults to OpenRouter, so a single key runs the whole demo. OpenRouter
    # serves OpenAI's text-embedding-3-large, the model the committed vectors
    # were built with.
    openrouter_api_key: str = Field(default="", description="Key for chat and embeddings.")
    llm_model: str = "anthropic/claude-haiku-5.5"
    llm_base_url: str = "https://openrouter.ai/api/v1"
    embedding_model: str = "openai/text-embedding-3-large"
    embedding_base_url: str = "https://openrouter.ai/api/v1"
    # text-embedding-3-large emits 3072-dim vectors; the Qdrant collection is
    # sized to match. Changing the model means re-sizing the collection.
    embedding_dim: int = 3072

    # --- Vector database ------------------------------------------------------
    # ":memory:" runs Qdrant in-process (qdrant-client local mode), seeded from
    # the committed vectors on startup: no vector server to host or pay for.
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "incidents_resolved"
    # Problems (root-cause records) live in their own collection, searched with
    # their own top-K.
    qdrant_problems_collection: str = "problems"
    # On startup, seed Qdrant from the committed embeddings if the collection is
    # empty (so `docker compose up` is self-contained). Disable for local API
    # dev when Qdrant is not running.
    auto_seed: bool = True

    # --- Retrieval (layer 2 of the three-layer retrieval) ---------------------
    # Keep only hits at or above this cosine similarity (range -1 to 1)...
    retrieval_min_similarity: float = 0.8
    # ...from at most this many resolved incidents...
    incident_top_k: int = 5
    # ...and at most this many Problems.
    problem_top_k: int = 10

    # --- Web / CORS -----------------------------------------------------------
    # Comma-separated list, so the local and the published site can share one API.
    frontend_origin: str = "http://localhost:3000"

    # --- Public demo guard-rails ---------------------------------------------
    # The published demo is open to a live audience, so every route that calls
    # a model is metered before any provider call. A whole room often shares
    # one NAT IP, so the per-client budget (browser-generated id) is the tight
    # one and the per-IP budget only stops a single abusive host.
    ai_window_seconds: int = 600
    ai_max_per_client: int = 20
    ai_max_per_ip: int = 300
    ai_max_per_day: int = 3000

    # --- Logging --------------------------------------------------------------
    log_level: str = "INFO"
    # When true, render logs as JSON (production-friendly); otherwise pretty
    # console output for local development.
    log_json: bool = False

    # --- Data locations -------------------------------------------------------
    # Committed artifacts: the dataset and the precomputed embeddings/clustering.
    # Defaults resolve next to the backend; override with DATA_DIR in Docker.
    data_dir: Path = _BACKEND_ROOT / "data"

    @property
    def incidents_path(self) -> Path:
        """Path to the committed synthetic dataset."""
        return self.data_dir / "incidents.json"

    @property
    def changes_path(self) -> Path:
        """Path to the committed synthetic change requests."""
        return self.data_dir / "changes.json"

    @property
    def problems_path(self) -> Path:
        """Path to the committed synthetic Problem records."""
        return self.data_dir / "problems.json"

    @property
    def precomputed_dir(self) -> Path:
        """Directory with committed embeddings + clustering result + labels."""
        return self.data_dir / "precomputed"

    @property
    def embeddings_path(self) -> Path:
        """Committed incident embeddings (compressed NumPy archive of id+vector)."""
        return self.precomputed_dir / "embeddings.npz"

    @property
    def summary_embeddings_path(self) -> Path:
        """Optional incident vectors built as the article builds the query.

        Written by ``scripts/reembed.py --incidents`` (summary + categoria,
        subcategoria, empresa). When present, the RAG collection is seeded from
        it; ``embeddings.npz`` (raw text) keeps serving the clustering.
        """
        return self.precomputed_dir / "summary_embeddings.npz"

    @property
    def problem_embeddings_path(self) -> Path:
        """Optional real Problem embeddings (``scripts/reembed.py --problems``).

        When absent, each Problem is indexed with the normalized mean vector of
        its linked incidents (a deterministic fallback that needs no API key).
        """
        return self.precomputed_dir / "problem_embeddings.npz"

    @property
    def clusters_path(self) -> Path:
        """Committed clustering result served by GET /api/clusters."""
        return self.precomputed_dir / "clusters.json"

    @property
    def has_llm(self) -> bool:
        """Whether the gateway key is configured (needed for every live AI call)."""
        return bool(self.openrouter_api_key)

    @property
    def frontend_origins(self) -> list[str]:
        """The CORS allow-list parsed from ``frontend_origin``."""
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Cached so the environment is parsed once. Tests can clear the cache via
    ``get_settings.cache_clear()`` when they need to override configuration.
    """
    return Settings()


# --- Selectable chat models --------------------------------------------------
# Public id (sent by the UI model picker) -> real OpenRouter model id. The API
# only honors ids in this allow-list; anything else falls back to the default
# (``llm_model``), which keeps cost and abuse bounded. All entries are small,
# fast models checked against OpenRouter's public model list on 2026-10-19.
SELECTABLE_MODELS: dict[str, str] = {
    "claude-haiku": "anthropic/claude-haiku-5.5",
    "gpt-luna": "openai/gpt-6-luna",
    "gemini-flash": "google/gemini-3.8-flash",
    "deepseek-flash": "deepseek/deepseek-v4.1-flash",
    "qwen-flash": "qwen/qwen3.7-flash",
}


def resolve_chat_model(public_id: str | None, settings: Settings) -> str:
    """Map a UI model id to a real OpenRouter model, or fall back to the default."""
    if public_id and public_id in SELECTABLE_MODELS:
        return SELECTABLE_MODELS[public_id]
    return settings.llm_model
