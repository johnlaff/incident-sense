"""Re-embed the knowledge base the way the article says the query is built.

The committed incident vectors embed the raw ``short_description`` and
``description`` (they were built for clustering). The article's query is the
AI summary plus categoria, subcategoria and empresa, so the base should be
embedded the same way. This needs a gateway key, so it is an offline step:

    uv run python scripts/reembed.py --incidents --problems

Outputs (both optional; ingestion prefers them when present):

* ``summary_embeddings.npz``: resolved incidents, summary + structured fields.
* ``problem_embeddings.npz``: Problems, description + root cause + fields.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from incident_sense.models import Incident, Problem
from incident_sense.rag.clients import EmbeddingClient, RagDeps
from incident_sense.rag.pipeline import LoadedIncident, build_query_text, summarize


def incident_summary_vectors(
    deps: RagDeps, incidents: list[Incident]
) -> tuple[list[str], npt.NDArray[np.float32]]:
    """Summarize each incident and embed summary + categoria, subcategoria, empresa."""
    ids: list[str] = []
    rows: list[list[float]] = []
    for incident in incidents:
        loaded = LoadedIncident(
            number=incident.number,
            short_description=incident.short_description,
            description=incident.description,
            category=incident.category,
            subcategory=incident.subcategory,
            empresa=incident.empresa,
            tags=list(incident.tags),
            from_base=True,
        )
        summary, _, _ = summarize(deps, loaded, deps.catalog.vocabulary)
        ids.append(incident.number)
        rows.append(deps.embeddings.embed(build_query_text(summary, loaded)))
    return ids, np.asarray(rows, dtype=np.float32)


def problem_text(problem: Problem) -> str:
    """The text a Problem is embedded from (same structured suffix as the query)."""
    return (
        f"{problem.short_description}. {problem.description} Causa raiz: {problem.root_cause}\n"
        f"Categoria: {problem.category}\n"
        f"Subcategoria: {problem.subcategory}\n"
        f"Empresa: {problem.empresa}"
    )


def problem_text_vectors(
    embeddings: EmbeddingClient, problems: list[Problem]
) -> tuple[list[str], npt.NDArray[np.float32]]:
    """Embed every Problem from :func:`problem_text`."""
    ids = [problem.number for problem in problems]
    rows = [embeddings.embed(problem_text(problem)) for problem in problems]
    return ids, np.asarray(rows, dtype=np.float32)
