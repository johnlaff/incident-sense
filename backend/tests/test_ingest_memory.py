from incident_sense.config import Settings
from incident_sense.data.ingest import ensure_seeded, make_qdrant_client
from incident_sense.data.precomputed import load_embeddings
from incident_sense.rag.clients import QdrantRetriever


def test_in_memory_qdrant_is_seeded_once_and_searchable() -> None:
    settings = Settings(_env_file=None, qdrant_url=":memory:")  # type: ignore[call-arg]
    seeded = ensure_seeded(settings, retries=1, delay=0)
    assert seeded > 0
    # The same process-wide client sees the seeded points (no second ingest).
    assert ensure_seeded(settings, retries=1, delay=0) == seeded

    ids, vectors = load_embeddings(settings.embeddings_path)
    retriever = QdrantRetriever(make_qdrant_client(settings), settings.qdrant_collection)
    hits = retriever.search(vectors[0].tolist(), top_k=3)
    assert len(hits) == 3
    assert hits[0].score > 0.99 or ids[0] not in {h.number for h in hits}
