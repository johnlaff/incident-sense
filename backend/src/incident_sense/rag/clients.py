"""Dependency-injected clients for the RAG pipeline.

The pipeline talks to a chat LLM, an embedding model, two vector collections
(resolved incidents and Problems), the incident base (step 1 loads from it) and
the work notes (step 7 publishes to them). Each is a small ``Protocol`` or a
plain object here, so tests can substitute fakes with no network access (see
tests/test_incident_pipeline.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from openai import OpenAI
from qdrant_client import QdrantClient

from incident_sense.config import Settings
from incident_sense.data.ingest import make_qdrant_client
from incident_sense.data.work_notes import WorkNotesStore, get_work_notes_store
from incident_sense.models import Incident
from incident_sense.providers import (
    chat_text,
    embed_texts,
    make_chat_client,
    make_embedding_client,
)
from incident_sense.rag.tags import TagCatalog, get_tag_catalog


class LLMClient(Protocol):
    """A minimal chat interface: system + user prompt in, text out."""

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        """Return the assistant's reply to a system + user prompt."""
        ...


class EmbeddingClient(Protocol):
    """Turn a single text into one embedding vector."""

    def embed(self, text: str) -> list[float]:
        """Return the embedding vector for ``text``."""
        ...


@dataclass(frozen=True)
class RetrievedHit:
    """One vector-search result: an incident number, its score and payload."""

    number: str
    score: float
    payload: dict[str, Any]


class VectorRetriever(Protocol):
    """Search the vector store, returning scored hits."""

    def search(
        self, vector: list[float], *, top_k: int, query_filter: Any | None = None
    ) -> list[RetrievedHit]:
        """Return up to ``top_k`` scored hits, optionally filtered."""
        ...


class IncidentLookup(Protocol):
    """Find an incident by number (the demo's stand-in for the ITSM)."""

    def get(self, number: str) -> Incident | None:
        """Return the incident, or None when unknown."""
        ...


class EmptyRetriever:
    """A collection with nothing in it (used when there is no Problem base)."""

    def search(
        self, vector: list[float], *, top_k: int, query_filter: Any | None = None
    ) -> list[RetrievedHit]:
        """Return no hits."""
        return []


# --- Concrete adapters -------------------------------------------------------
class OpenAILLMClient:
    """LLMClient backed by an OpenAI-compatible chat endpoint (OpenRouter)."""

    def __init__(self, client: OpenAI, model: str, *, reasoning: bool | None = None) -> None:
        self._client = client
        self._model = model
        self._reasoning = reasoning

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        """Run a chat completion through the configured model."""
        return chat_text(
            self._client,
            self._model,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
            reasoning=self._reasoning,
        )


class OpenAIEmbeddingClient:
    """EmbeddingClient backed by OpenAI embeddings."""

    def __init__(self, client: OpenAI, model: str) -> None:
        self._client = client
        self._model = model

    def embed(self, text: str) -> list[float]:
        """Embed a single text and return its vector."""
        return embed_texts(self._client, self._model, [text])[0]


class QdrantRetriever:
    """VectorRetriever backed by Qdrant's ``query_points`` API."""

    def __init__(self, client: QdrantClient, collection: str) -> None:
        self._client = client
        self._collection = collection

    def search(
        self, vector: list[float], *, top_k: int, query_filter: Any | None = None
    ) -> list[RetrievedHit]:
        """Query Qdrant and map the scored points to RetrievedHit."""
        response = self._client.query_points(
            self._collection,
            query=vector,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True,
        )
        hits: list[RetrievedHit] = []
        for point in response.points:
            payload: dict[str, Any] = point.payload or {}
            hits.append(
                RetrievedHit(
                    number=str(payload.get("number", "")),
                    score=float(point.score),
                    payload=payload,
                )
            )
        return hits


@dataclass(frozen=True)
class RagDeps:
    """The injected clients the pipeline needs.

    Only the first three are required; the rest default to "nothing there" so a
    caller that only has a chat model, an embedder and an incident index still
    runs the pipeline (no Problems, no tag catalog, nowhere to publish).
    """

    llm: LLMClient
    embeddings: EmbeddingClient
    retriever: VectorRetriever
    problem_retriever: VectorRetriever = field(default_factory=EmptyRetriever)
    catalog: TagCatalog = field(default_factory=TagCatalog)
    incidents: IncidentLookup | None = None
    notes: WorkNotesStore | None = None


def build_deps(settings: Settings) -> RagDeps:
    """Build the real (network-backed) dependencies from settings."""
    # Imported here: the repository pulls the clustering artifacts, which only
    # the live endpoint needs.
    from incident_sense.api.incidents import get_incident_repository

    client = make_qdrant_client(settings)
    return RagDeps(
        llm=OpenAILLMClient(make_chat_client(settings), settings.llm_model),
        embeddings=OpenAIEmbeddingClient(make_embedding_client(settings), settings.embedding_model),
        retriever=QdrantRetriever(client, settings.qdrant_collection),
        problem_retriever=QdrantRetriever(client, settings.qdrant_problems_collection),
        catalog=get_tag_catalog(),
        incidents=get_incident_repository(),
        notes=get_work_notes_store(),
    )
