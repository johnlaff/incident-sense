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


def test_problems_are_indexed_in_their_own_collection_with_tags() -> None:
    from qdrant_client import models as qm

    from incident_sense.data.ingest import ensure_problems_seeded
    from incident_sense.data.loader import load_problems

    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, qdrant_url=":memory:", qdrant_problems_collection="problems_test"
    )
    ensure_seeded(settings, retries=1, delay=0)
    problems = load_problems(settings.problems_path)
    assert len(problems) >= 8
    assert ensure_problems_seeded(settings) == len(problems)
    # Idempotent: a second call finds the collection already filled.
    assert ensure_problems_seeded(settings) == len(problems)

    # Without real Problem embeddings, each Problem sits at the mean of its
    # linked incidents, so one of those incidents finds it with a high cosine.
    ids, vectors = load_embeddings(settings.embeddings_path)
    first = problems[0]
    vector = vectors[ids.index(first.linked_incidents[0])].tolist()
    retriever = QdrantRetriever(make_qdrant_client(settings), settings.qdrant_problems_collection)
    only_pix = qm.Filter(must=[qm.FieldCondition(key="tags", match=qm.MatchAny(any=["pix"]))])
    hits = retriever.search(vector, top_k=10, query_filter=only_pix)
    assert first.number in {hit.number for hit in hits}
    assert all("pix" in hit.payload["tags"] for hit in hits)
    assert hits[0].payload["root_cause"]


def test_reembedding_builds_the_base_like_the_query() -> None:
    from incident_sense.data.loader import load_incidents, load_problems, resolved_incidents
    from incident_sense.data.reembed import incident_summary_vectors, problem_text_vectors
    from incident_sense.rag.clients import RagDeps

    class _LLM:
        def complete(self, system: str, user: str, **_: object) -> str:
            return '{"resumo": "resumo curto", "tags": []}'

    class _Embeddings:
        def __init__(self) -> None:
            self.texts: list[str] = []

        def embed(self, text: str) -> list[float]:
            self.texts.append(text)
            return [1.0, 0.0]

    class _Retriever:
        def search(self, vector: list[float], *, top_k: int, query_filter: object = None) -> list:  # type: ignore[type-arg]
            return []

    embeddings = _Embeddings()
    deps = RagDeps(llm=_LLM(), embeddings=embeddings, retriever=_Retriever())
    incidents = resolved_incidents(load_incidents())[:2]
    ids, vectors = incident_summary_vectors(deps, incidents)
    assert ids == [i.number for i in incidents]
    assert vectors.shape == (2, 2)
    assert embeddings.texts[0].startswith("resumo curto\nCategoria: ")
    assert "Empresa: Banco Meridiano" in embeddings.texts[0]

    problems = load_problems()[:3]
    ids, vectors = problem_text_vectors(embeddings, problems)
    assert ids == [p.number for p in problems]
    assert "Causa raiz:" in embeddings.texts[-1]
