"""Load the committed dataset + embeddings into Qdrant.

Only *resolved* incidents are ingested: they are the knowledge base the RAG flow
searches over. Vectors come from the committed ``embeddings.npz``, so seeding
needs **zero** embedding API calls.

This module is used two ways:

* ``scripts/ingest.py`` calls :func:`ingest` (``make seed``).
* the API's startup hook calls :func:`ensure_seeded`, which is idempotent and
  tolerant of Qdrant still booting.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models as qm

from incident_sense.config import Settings, get_settings
from incident_sense.data.loader import load_incidents, resolved_incidents
from incident_sense.data.precomputed import load_embeddings
from incident_sense.logging import get_logger
from incident_sense.models import Incident

log = get_logger(__name__)

# Fixed namespace so an incident number always maps to the same Qdrant point id
# (Qdrant ids must be ints or UUIDs; the human-readable number lives in payload).
_ID_NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")

_UPSERT_BATCH = 256


def point_id(number: str) -> str:
    """Deterministic UUID point id for an incident number."""
    return str(uuid.uuid5(_ID_NAMESPACE, number))


def make_qdrant_client(settings: Settings) -> QdrantClient:
    """Create a Qdrant client from settings."""
    return QdrantClient(url=settings.qdrant_url)


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
        "priority": int(incident.priority),
        "state": str(incident.state),
        "resolution_notes": incident.resolution_notes,
        "close_code": incident.close_code,
        "tags": incident.tags,
    }


def ensure_collection(client: QdrantClient, settings: Settings, *, recreate: bool) -> None:
    """Create the collection (sized to the embedding dim, cosine), optionally fresh."""
    exists = client.collection_exists(settings.qdrant_collection)
    if exists and recreate:
        client.delete_collection(settings.qdrant_collection)
        exists = False
    if not exists:
        client.create_collection(
            settings.qdrant_collection,
            vectors_config=qm.VectorParams(
                size=settings.embedding_dim,
                distance=qm.Distance.COSINE,
            ),
        )


def collection_count(client: QdrantClient, settings: Settings) -> int:
    """Number of points in the collection (0 if it does not exist)."""
    if not client.collection_exists(settings.qdrant_collection):
        return 0
    return int(client.count(settings.qdrant_collection).count)


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
    ids, vectors = load_embeddings(settings.embeddings_path)
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
                return existing
            return ingest(settings, client=client, recreate=True)
        except Exception as exc:  # noqa: BLE001 - Qdrant may not be reachable yet
            last_error = exc
            log.warning("qdrant_not_ready", attempt=attempt + 1, error=str(exc))
            time.sleep(delay)
    log.error("qdrant_seed_failed", error=str(last_error))
    return 0
