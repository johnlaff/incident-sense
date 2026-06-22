"""Recurrence clustering.

The clustering *result* is precomputed and committed (``backend/data/precomputed/
clusters.json``) and served verbatim by ``GET /api/clusters`` — so the runtime
needs no heavy ML dependencies. The pipeline that (re)builds it (BERTopic: UMAP
+ HDBSCAN + LLM labels) lives in ``backend/scripts/precompute.py``.
"""
