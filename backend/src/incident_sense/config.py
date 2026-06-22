"""Application configuration (12-factor, read from the environment).

All tunables live here so the rest of the code never reads ``os.environ``
directly. Values come from environment variables (and a local ``.env`` during
development); secrets are never hard-coded.

The numeric retrieval thresholds (``example_top_k`` / ``example_min_similarity``)
are **illustrative demo values**, not anyone's production tuning.
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
    # Embeddings run on OpenAI. Chat/reasoning runs on an OpenAI-compatible
    # endpoint that defaults to OpenRouter (configurable, so the same code can
    # point at OpenAI or any compatible gateway).
    openai_api_key: str = Field(default="", description="OpenAI key, used for embeddings.")
    openrouter_api_key: str = Field(default="", description="Key for the chat/reasoning LLM.")
    llm_model: str = "deepseek/deepseek-v4-flash"
    llm_base_url: str = "https://openrouter.ai/api/v1"
    embedding_model: str = "text-embedding-3-large"
    # text-embedding-3-large emits 3072-dim vectors; the Qdrant collection is
    # sized to match. Changing the model means re-sizing the collection.
    embedding_dim: int = 3072

    # --- Vector database ------------------------------------------------------
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "incidents_resolved"
    # On startup, seed Qdrant from the committed embeddings if the collection is
    # empty (so `docker compose up` is self-contained). Disable for local API
    # dev when Qdrant is not running.
    auto_seed: bool = True

    # --- Retrieval thresholds (illustrative example values) -------------------
    # Return at most this many candidates from vector search...
    example_top_k: int = 5
    # ...and only those at or above this cosine similarity. Cosine similarity
    # ranges from -1 to 1; 0.4 is a permissive demo floor, not a tuned value.
    example_min_similarity: float = 0.4

    # --- Web / CORS -----------------------------------------------------------
    frontend_origin: str = "http://localhost:3000"

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
    def precomputed_dir(self) -> Path:
        """Directory with committed embeddings + clustering result + labels."""
        return self.data_dir / "precomputed"

    @property
    def embeddings_path(self) -> Path:
        """Committed incident embeddings (compressed NumPy archive of id+vector)."""
        return self.precomputed_dir / "embeddings.npz"

    @property
    def clusters_path(self) -> Path:
        """Committed clustering result served by GET /api/clusters."""
        return self.precomputed_dir / "clusters.json"

    @property
    def has_openai(self) -> bool:
        """Whether an OpenAI key is configured (needed for live embedding)."""
        return bool(self.openai_api_key)

    @property
    def has_llm(self) -> bool:
        """Whether a chat-LLM key is configured (needed for the live RAG path)."""
        return bool(self.openrouter_api_key)


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Cached so the environment is parsed once. Tests can clear the cache via
    ``get_settings.cache_clear()`` when they need to override configuration.
    """
    return Settings()
