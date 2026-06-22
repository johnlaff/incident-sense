"""Dependency-injected clients for the RAG pipeline.

The pipeline talks to three things: a chat LLM, an embedding model, and a vector
store. Each is defined here as a small ``Protocol`` plus a concrete adapter, so
tests can substitute fakes with no network access (see tests/test_rag.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from openai import OpenAI
from qdrant_client import QdrantClient

from incident_sense.config import Settings
from incident_sense.data.ingest import make_qdrant_client
from incident_sense.providers import (
    chat_text,
    embed_texts,
    make_chat_client,
    make_embedding_client,
)


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


# --- Concrete adapters -------------------------------------------------------
class OpenAILLMClient:
    """LLMClient backed by an OpenAI-compatible chat endpoint (OpenRouter)."""

    def __init__(self, client: OpenAI, model: str) -> None:
        self._client = client
        self._model = model

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
    """The three injected clients the pipeline needs."""

    llm: LLMClient
    embeddings: EmbeddingClient
    retriever: VectorRetriever


def build_deps(settings: Settings) -> RagDeps:
    """Build the real (network-backed) dependencies from settings."""
    return RagDeps(
        llm=OpenAILLMClient(make_chat_client(settings), settings.llm_model),
        embeddings=OpenAIEmbeddingClient(make_embedding_client(settings), settings.embedding_model),
        retriever=QdrantRetriever(make_qdrant_client(settings), settings.qdrant_collection),
    )
