"""Precompute and commit the embeddings + clustering result.

Pipeline (run once, output committed):
    1. Load the committed dataset.
    2. Embed every incident's text with OpenAI (text-embedding-3-large, 3072d).
    3. Save the embeddings (so Qdrant can be seeded with zero API calls).
    4. Cluster with BERTopic: a *2D* UMAP (cosine, fixed random_state) feeds
       HDBSCAN, and an LLM representation model names each cluster.
    5. Save the 2D coordinates + cluster id + label + outlier flag per incident
       to clusters.json, which GET /api/clusters serves verbatim.

Why 2D UMAP for clustering: BERTopic clusters on the UMAP-reduced space, and
reducing straight to 2D gives coordinates we can plot directly while keeping the
clusters legible for this demo-sized dataset.

Why cosine: embeddings encode meaning by direction, so angular (cosine) distance
groups semantically similar incidents better than raw Euclidean distance.

Usage:
    uv run python scripts/precompute.py
    uv run python scripts/precompute.py --min-cluster-size 18
"""

from __future__ import annotations

import argparse
import sys

import numpy as np

from incident_sense.config import get_settings
from incident_sense.data.loader import load_incidents
from incident_sense.data.precomputed import load_embeddings, save_embeddings
from incident_sense.models import (
    OUTLIER_CLUSTER_ID,
    ClusterPoint,
    ClustersResponse,
    ClusterSummary,
)
from incident_sense.providers import embed_texts, make_chat_client, make_embedding_client

# A small Portuguese stopword list so the cluster keywords (which feed the LLM
# label prompt) are meaningful instead of dominated by function words.
PT_STOPWORDS = [
    "a",
    "o",
    "os",
    "as",
    "um",
    "uma",
    "uns",
    "umas",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "por",
    "para",
    "com",
    "sem",
    "sob",
    "ao",
    "aos",
    "e",
    "ou",
    "que",
    "se",
    "na",
    "nao",
    "não",
    "sim",
    "ja",
    "já",
    "the",
    "of",
    "and",
    "is",
    "to",
    "ele",
    "ela",
    "isso",
    "este",
    "esta",
    "esse",
    "essa",
    "como",
    "mas",
    "mais",
    "menos",
    "muito",
    "pouco",
    "ser",
    "estar",
    "foi",
    "está",
    "esta",
    "cliente",
    "clientes",
    "usuario",
    "usuário",
    "sistema",
    "erro",
    "problema",
    "ocorre",
    "ocorreu",
    "apos",
    "após",
]

# Label prompt for the LLM representation model. [KEYWORDS]/[DOCUMENTS] are
# replaced by BERTopic with the cluster's top words and example incidents.
LABEL_SYSTEM_PROMPT = (
    "Você nomeia grupos de incidentes de TI de um banco. Responda apenas com "
    "um rótulo curto em português (no máximo 5 palavras), sem aspas e sem "
    "pontuação final."
)
LABEL_PROMPT = (
    "Tenho um grupo de incidentes com estas palavras-chave: [KEYWORDS]\n"
    "Exemplos de chamados deste grupo:\n[DOCUMENTS]\n\n"
    "Dê um rótulo curto e descritivo (máx. 5 palavras) para o problema comum "
    "deste grupo, em português."
)


def _incident_text(short_description: str, description: str) -> str:
    """The text we embed and cluster on: the *problem*, not the resolution."""
    return f"{short_description}. {description}".strip()


def _embed_all(model: str, texts: list[str]) -> np.ndarray:
    """Embed all texts in batches, returning an (N, 3072) float32 array."""
    settings = get_settings()
    client = make_embedding_client(settings)
    vectors: list[list[float]] = []
    batch = 128
    for start in range(0, len(texts), batch):
        chunk = texts[start : start + batch]
        vectors.extend(embed_texts(client, model, chunk))
        print(f"  embedded {min(start + batch, len(texts))}/{len(texts)}", file=sys.stderr)
    return np.asarray(vectors, dtype=np.float32)


def _clean_label(raw: str, fallback: str) -> str:
    """Tidy an LLM-produced cluster label."""
    label = raw.strip().strip('"').strip("'").rstrip(".").strip()
    return label[:60] if label else fallback


def _build_topic_model(min_cluster_size: int, min_samples: int | None) -> object:
    """Assemble a BERTopic model with 2D cosine UMAP + HDBSCAN + LLM labels.

    Heavy ML imports happen here (lazily) so importing this script is cheap and
    the API runtime never needs them.
    """
    from bertopic import BERTopic
    from bertopic.representation import OpenAI as BERTopicOpenAI
    from hdbscan import HDBSCAN
    from sklearn.feature_extraction.text import CountVectorizer
    from umap import UMAP

    settings = get_settings()

    umap_model = UMAP(
        n_components=2,  # reduce straight to 2D so coords are directly plottable
        n_neighbors=15,
        min_dist=0.0,
        metric="cosine",  # embeddings are directional; cosine groups by meaning
        random_state=42,  # fixed seed -> identical layout every run
    )
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        # Higher min_samples is more conservative, so the diverse noise
        # incidents are left as outliers (cluster -1) instead of absorbed.
        min_samples=min_samples,
        metric="euclidean",  # operates on the UMAP-reduced space
        cluster_selection_method="eom",
        prediction_data=True,
    )
    vectorizer_model = CountVectorizer(stop_words=PT_STOPWORDS, min_df=2, ngram_range=(1, 2))
    representation_model = BERTopicOpenAI(
        client=make_chat_client(settings),
        model=settings.llm_model,
        prompt=LABEL_PROMPT,
        system_prompt=LABEL_SYSTEM_PROMPT,
        nr_docs=6,
        # Truncate example docs to keep the labeling prompt small; doc_length
        # requires a tokenizer to be set.
        tokenizer="whitespace",
        doc_length=100,
        exponential_backoff=True,
    )
    return BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        representation_model=representation_model,
        calculate_probabilities=False,
        verbose=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Precompute embeddings + clustering.")
    parser.add_argument("--min-cluster-size", type=int, default=15)
    parser.add_argument(
        "--min-samples",
        type=int,
        default=None,
        help="HDBSCAN min_samples; higher leaves more diverse incidents as outliers.",
    )
    parser.add_argument(
        "--reuse-embeddings",
        action="store_true",
        help="Reuse the committed embeddings.npz instead of recomputing them.",
    )
    args = parser.parse_args()

    settings = get_settings()
    incidents = load_incidents()
    print(f"Loaded {len(incidents)} incidents.", file=sys.stderr)

    # --- 1) Embeddings -------------------------------------------------------
    ids = [inc.number for inc in incidents]
    texts = [_incident_text(inc.short_description, inc.description) for inc in incidents]
    if args.reuse_embeddings and settings.embeddings_path.exists():
        saved_ids, saved_vectors = load_embeddings(settings.embeddings_path)
        vector_by_id = {number: saved_vectors[index] for index, number in enumerate(saved_ids)}
        embeddings = np.asarray([vector_by_id[number] for number in ids], dtype=np.float32)
        print(f"Reused embeddings from {settings.embeddings_path}", file=sys.stderr)
    else:
        print(f"Embedding with {settings.embedding_model}...", file=sys.stderr)
        embeddings = _embed_all(settings.embedding_model, texts)
        save_embeddings(settings.embeddings_path, ids, embeddings)
        print(f"Saved embeddings -> {settings.embeddings_path}", file=sys.stderr)

    # --- 2) Clustering -------------------------------------------------------
    print("Clustering with BERTopic (UMAP 2D + HDBSCAN + LLM labels)...", file=sys.stderr)
    topic_model = _build_topic_model(args.min_cluster_size, args.min_samples)
    topics, _ = topic_model.fit_transform(texts, embeddings=embeddings)  # type: ignore[attr-defined]
    coords = np.asarray(topic_model.umap_model.embedding_, dtype=float)  # type: ignore[attr-defined]

    # Map each topic id to a clean label (topic -1 == HDBSCAN noise/outliers).
    info = topic_model.get_topic_info()  # type: ignore[attr-defined]
    label_by_topic: dict[int, str] = {}
    for row in info.to_dict("records"):
        topic_id = int(row["Topic"])
        representation = row.get("Representation") or []
        raw_label = representation[0] if representation else str(row.get("Name", ""))
        label_by_topic[topic_id] = (
            "Outliers"
            if topic_id == OUTLIER_CLUSTER_ID
            else _clean_label(raw_label, f"Grupo {topic_id}")
        )

    points: list[ClusterPoint] = []
    sizes: dict[int, int] = {}
    for incident, topic_id, (x, y) in zip(incidents, topics, coords, strict=True):
        tid = int(topic_id)
        sizes[tid] = sizes.get(tid, 0) + 1
        points.append(
            ClusterPoint(
                id=incident.number,
                x=float(x),
                y=float(y),
                cluster_id=tid,
                cluster_label=label_by_topic.get(tid, f"Grupo {tid}"),
                is_outlier=tid == OUTLIER_CLUSTER_ID,
                short_description=incident.short_description,
                priority=int(incident.priority),
            )
        )

    clusters = [
        ClusterSummary(cluster_id=tid, label=label_by_topic[tid], size=size)
        for tid, size in sorted(sizes.items())
        if tid != OUTLIER_CLUSTER_ID
    ]
    response = ClustersResponse(
        points=points,
        clusters=clusters,
        total=len(points),
        outliers=sizes.get(OUTLIER_CLUSTER_ID, 0),
    )

    settings.clusters_path.parent.mkdir(parents=True, exist_ok=True)
    settings.clusters_path.write_text(response.model_dump_json(indent=2), encoding="utf-8")
    print(
        f"Saved {len(points)} points in {len(clusters)} clusters "
        f"({response.outliers} outliers) -> {settings.clusters_path}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
