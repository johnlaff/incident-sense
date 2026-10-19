"""Load the committed dataset + embeddings into Qdrant.

Only *resolved* incidents are ingested: they are the knowledge base the RAG flow
searches over. Vectors come from the committed ``embeddings.npz``, so seeding
needs **zero** embedding API calls.

This module is used two ways:

* ``scripts/ingest.py`` calls :func:`ingest` (``make seed``).
* the API's startup hook calls :func:`ensure_seeded`, which is idempotent and
  tolerant of Qdrant still booting.

The synthetic Problems go to their own collection (:func:`ingest_problems`).
Their vectors come from ``problem_embeddings.npz`` when it exists; otherwise
each Problem is placed at the normalized mean of its linked incidents' vectors,
a deterministic fallback that needs no API key.
"""

from __future__ import annotations

import time
import uuid
from functools import lru_cache
from typing import Any

import numpy as np
import numpy.typing as npt
from qdrant_client import QdrantClient
from qdrant_client import models as qm

from incident_sense.config import Settings, get_settings
from incident_sense.data.loader import load_incidents, load_problems, resolved_incidents
from incident_sense.data.precomputed import load_embeddings
from incident_sense.logging import get_logger
from incident_sense.models import Incident, Problem

log = get_logger(__name__)

# Fixed namespace so an incident number always maps to the same Qdrant point id
# (Qdrant ids must be ints or UUIDs; the human-readable number lives in payload).
_ID_NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")

_UPSERT_BATCH = 256


def point_id(number: str) -> str:
    """Deterministic UUID point id for an incident number."""
    return str(uuid.uuid5(_ID_NAMESPACE, number))


IN_MEMORY = ":memory:"


@lru_cache(maxsize=4)
def _client_for(url: str) -> QdrantClient:
    # One client per URL for the whole process. For a server this just reuses
    # the connection pool; for ":memory:" it is essential, because each local
    # client owns its own private store and a fresh one would be empty.
    if url == IN_MEMORY:
        return QdrantClient(location=IN_MEMORY)
    return QdrantClient(url=url)


def make_qdrant_client(settings: Settings) -> QdrantClient:
    """Return the process-wide Qdrant client for ``settings.qdrant_url``.

    ``QDRANT_URL=:memory:`` selects qdrant-client's in-process local mode, so the
    published demo needs no vector server.
    """
    return _client_for(settings.qdrant_url)


def _payload(incident: Incident) -> dict[str, Any]:
    """The metadata stored alongside each vector (for filtering + display)."""
    return {
        "number": incident.number,
        "short_description": incident.short_description,
        "description": incident.description,
        "category": incident.category,
        "subcategory": incident.subcategory,
        "cmdb_ci": incident.cmdb_ci,
        "assignment_group": incident.assignment_group,
        "empresa": incident.empresa,
        "priority": int(incident.priority),
        "state": str(incident.state),
        "resolution_notes": incident.resolution_notes,
        "close_code": incident.close_code,
        "tags": incident.tags,
    }


def _problem_payload(problem: Problem) -> dict[str, Any]:
    """The metadata stored alongside each Problem vector."""
    return {
        "number": problem.number,
        "short_description": problem.short_description,
        "description": problem.description,
        "root_cause": problem.root_cause,
        "workaround": problem.workaround,
        "permanent_fix": problem.permanent_fix,
        "category": problem.category,
        "subcategory": problem.subcategory,
        "cmdb_ci": problem.cmdb_ci,
        "empresa": problem.empresa,
        "state": problem.state,
        "tags": problem.tags,
        "linked_incidents": problem.linked_incidents,
    }


def ensure_collection(
    client: QdrantClient, settings: Settings, *, recreate: bool, name: str | None = None
) -> None:
    """Create a collection (sized to the embedding dim, cosine), optionally fresh."""
    collection = name or settings.qdrant_collection
    exists = client.collection_exists(collection)
    if exists and recreate:
        client.delete_collection(collection)
        exists = False
    if not exists:
        client.create_collection(
            collection,
            vectors_config=qm.VectorParams(
                size=settings.embedding_dim,
                distance=qm.Distance.COSINE,
            ),
        )


def collection_count(client: QdrantClient, settings: Settings, name: str | None = None) -> int:
    """Number of points in a collection (0 if it does not exist)."""
    collection = name or settings.qdrant_collection
    if not client.collection_exists(collection):
        return 0
    return int(client.count(collection).count)


def ingest(
    settings: Settings | None = None,
    *,
    client: QdrantClient | None = None,
    recreate: bool = True,
) -> int:
    """Ingest all resolved incidents into Qdrant; return how many were stored."""
    settings = settings or get_settings()
    client = client or make_qdrant_client(settings)

    incidents = resolved_incidents(load_incidents())
    # Prefer the summary-based vectors (scripts/reembed.py) when they exist.
    source = (
        settings.summary_embeddings_path
        if settings.summary_embeddings_path.exists()
        else settings.embeddings_path
    )
    ids, vectors = load_embeddings(source)
    vector_by_number = {number: vectors[index] for index, number in enumerate(ids)}

    ensure_collection(client, settings, recreate=recreate)

    points = [
        qm.PointStruct(
            id=point_id(incident.number),
            vector=vector_by_number[incident.number].tolist(),
            payload=_payload(incident),
        )
        for incident in incidents
        if incident.number in vector_by_number
    ]
    for start in range(0, len(points), _UPSERT_BATCH):
        client.upsert(settings.qdrant_collection, points=points[start : start + _UPSERT_BATCH])

    log.info("ingested", collection=settings.qdrant_collection, points=len(points))
    return len(points)


def problem_vectors(
    problems: list[Problem], settings: Settings
) -> dict[str, npt.NDArray[np.float32]]:
    """One vector per Problem: real embeddings if committed, else the linked mean.

    The fallback is the normalized mean of the linked incidents' committed
    vectors: deterministic, offline, and close to every incident in the group.
    """
    if settings.problem_embeddings_path.exists():
        ids, vectors = load_embeddings(settings.problem_embeddings_path)
        return {number: vectors[index] for index, number in enumerate(ids)}
    ids, vectors = load_embeddings(settings.embeddings_path)
    index = {number: position for position, number in enumerate(ids)}
    out: dict[str, npt.NDArray[np.float32]] = {}
    for problem in problems:
        rows = [index[n] for n in problem.linked_incidents if n in index]
        if not rows:
            continue
        mean = vectors[rows].mean(axis=0)
        norm = float(np.linalg.norm(mean))
        out[problem.number] = (mean / norm if norm else mean).astype(np.float32)
    return out


def ingest_problems(
    settings: Settings | None = None,
    *,
    client: QdrantClient | None = None,
    recreate: bool = True,
) -> int:
    """Index the synthetic Problems in their own collection; return how many."""
    settings = settings or get_settings()
    client = client or make_qdrant_client(settings)
    problems = load_problems(settings.problems_path)
    vectors = problem_vectors(problems, settings)
    name = settings.qdrant_problems_collection
    ensure_collection(client, settings, recreate=recreate, name=name)
    points = [
        qm.PointStruct(
            id=point_id(problem.number),
            vector=vectors[problem.number].tolist(),
            payload=_problem_payload(problem),
        )
        for problem in problems
        if problem.number in vectors
    ]
    if points:
        client.upsert(name, points=points)
    log.info("ingested", collection=name, points=len(points))
    return len(points)


def ensure_problems_seeded(settings: Settings | None = None) -> int:
    """Seed the Problems collection once if empty; return its size."""
    settings = settings or get_settings()
    client = make_qdrant_client(settings)
    existing = collection_count(client, settings, settings.qdrant_problems_collection)
    if existing > 0:
        return existing
    return ingest_problems(settings, client=client, recreate=True)


def ensure_seeded(
    settings: Settings | None = None, *, retries: int = 30, delay: float = 2.0
) -> int:
    """Seed Qdrant once if empty; retry while Qdrant is still booting.

    Returns the number of points in the collection (0 if seeding ultimately
    failed — the API still serves /health and /clusters in that case).
    """
    settings = settings or get_settings()
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            client = make_qdrant_client(settings)
            existing = collection_count(client, settings)
            if existing > 0:
                log.info("already_seeded", points=existing)
            else:
                existing = ingest(settings, client=client, recreate=True)
            ensure_problems_seeded(settings)
            return existing
        except Exception as exc:  # noqa: BLE001 - Qdrant may not be reachable yet
            last_error = exc
            log.warning("qdrant_not_ready", attempt=attempt + 1, error=str(exc))
            time.sleep(delay)
    log.error("qdrant_seed_failed", error=str(last_error))
    return 0
