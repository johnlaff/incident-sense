"""Deterministic metrics — pure functions, no I/O, unit-testable under pytest.

PROTOTYPE. These are the metrics the PR gate runs offline with zero cost: they
consume only the typed observation (``EvalExecution``) and the gold (``Expected``)
and return ``MetricResult``. Two families are implemented for real here — the two
the ticket asks to make concrete:

* **Retrieval by IDs** with graded relevance 0-2 (#20 §2): precision, recall,
  hit, MRR and nDCG@k. A relevant hit is ``relevance > 0``; nDCG uses the grades.
* **Citation structural validity/coverage**: computed over the *typed* citation
  structure, never by regex over Markdown — forged or forbidden ids are caught
  as a 100%-per-case gate (research §citações).

Every metric declares its numerator, denominator and applicability. A zero
denominator yields ``value=None`` (``not_applicable``), so an empty gold can
never masquerade as a perfect (or zero) score.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from .schema import Expected, MetricResult, ObservedCitation, RequiredClaim


def _na(name: str, unit: str, denominator: float = 0.0, slice_: str = "") -> MetricResult:
    """A not-applicable result (empty denominator)."""
    return MetricResult(
        name=name, unit=unit, value=None, numerator=0.0, denominator=denominator, slice=slice_
    )


# --- Retrieval ---------------------------------------------------------------
def _is_relevant(gold: dict[str, int], incident_id: str) -> bool:
    """A hit counts as relevant when its graded relevance is above zero."""
    return gold.get(incident_id, 0) > 0


def _unique(ranked_ids: Sequence[str]) -> list[str]:
    """Deduplicate a ranking, preserving first occurrence.

    A ranking is a list of *distinct* incidents in rank order; a repeated id
    would otherwise inflate recall past 1.0 and nDCG past its ideal. Dedup is
    done before truncating to k so a later distinct id is not lost.
    """
    seen: set[str] = set()
    out: list[str] = []
    for incident_id in ranked_ids:
        if incident_id not in seen:
            seen.add(incident_id)
            out.append(incident_id)
    return out


def precision_at_k(
    ranked_ids: Sequence[str], gold: dict[str, int], *, k: int, slice_: str = ""
) -> MetricResult:
    """Fraction of the top-k that is relevant. Denominator is k."""
    if k <= 0:
        return _na("precision@k", "ratio", slice_=slice_)
    top = _unique(ranked_ids)[:k]
    relevant = sum(1 for i in top if _is_relevant(gold, i))
    return MetricResult(
        name=f"precision@{k}",
        unit="ratio",
        value=relevant / k,
        numerator=relevant,
        denominator=k,
        slice=slice_,
    )


def recall_at_k(
    ranked_ids: Sequence[str], gold: dict[str, int], *, k: int, slice_: str = ""
) -> MetricResult:
    """Fraction of gold-relevant incidents recovered in the top-k."""
    total_relevant = sum(1 for r in gold.values() if r > 0)
    if total_relevant == 0:
        return _na(f"recall@{k}", "ratio", slice_=slice_)
    top = _unique(ranked_ids)[:k]
    found = sum(1 for i in top if _is_relevant(gold, i))
    return MetricResult(
        name=f"recall@{k}",
        unit="ratio",
        value=found / total_relevant,
        numerator=found,
        denominator=total_relevant,
        slice=slice_,
    )


def hit_at_k(
    ranked_ids: Sequence[str], gold: dict[str, int], *, k: int, slice_: str = ""
) -> MetricResult:
    """1.0 when at least one relevant incident appears in the top-k, else 0.0."""
    total_relevant = sum(1 for r in gold.values() if r > 0)
    if total_relevant == 0:
        return _na(f"hit@{k}", "binary", slice_=slice_)
    top = _unique(ranked_ids)[:k]
    hit = any(_is_relevant(gold, i) for i in top)
    return MetricResult(
        name=f"hit@{k}",
        unit="binary",
        value=1.0 if hit else 0.0,
        numerator=1.0 if hit else 0.0,
        denominator=1.0,
        slice=slice_,
    )


def mrr(ranked_ids: Sequence[str], gold: dict[str, int], *, slice_: str = "") -> MetricResult:
    """Reciprocal rank of the first relevant hit (0.0 if none)."""
    total_relevant = sum(1 for r in gold.values() if r > 0)
    if total_relevant == 0:
        return _na("mrr", "ratio", slice_=slice_)
    for position, incident_id in enumerate(_unique(ranked_ids), start=1):
        if _is_relevant(gold, incident_id):
            return MetricResult(
                name="mrr",
                unit="ratio",
                value=1.0 / position,
                numerator=1.0,
                denominator=float(position),
                slice=slice_,
            )
    return MetricResult(
        name="mrr", unit="ratio", value=0.0, numerator=0.0, denominator=1.0, slice=slice_
    )


def _dcg(relevances: Sequence[int]) -> float:
    """Discounted cumulative gain over 1-indexed positions."""
    return sum(rel / math.log2(position + 1) for position, rel in enumerate(relevances, start=1))


def ndcg_at_k(
    ranked_ids: Sequence[str], gold: dict[str, int], *, k: int, slice_: str = ""
) -> MetricResult:
    """Graded nDCG@k. Rewards putting the most-relevant evidence first.

    IDCG is the DCG of the ideal ordering of the gold grades, truncated to k. A
    zero IDCG (no gold relevance) yields not-applicable.
    """
    top = _unique(ranked_ids)[:k]
    gains = [gold.get(i, 0) for i in top]
    ideal = sorted(gold.values(), reverse=True)[:k]
    idcg = _dcg(ideal)
    if idcg == 0.0:
        return _na(f"ndcg@{k}", "ratio", slice_=slice_)
    dcg = _dcg(gains)
    return MetricResult(
        name=f"ndcg@{k}",
        unit="ratio",
        value=dcg / idcg,
        numerator=dcg,
        denominator=idcg,
        slice=slice_,
    )


def false_retrieval_rate(
    ranked_ids: Sequence[str], gold: dict[str, int], *, slice_: str = ""
) -> MetricResult:
    """Whether any source is returned when the case has no gold evidence.

    Only meaningful for the "no historical evidence" families; returns
    not-applicable when gold evidence exists.
    """
    total_relevant = sum(1 for r in gold.values() if r > 0)
    if total_relevant > 0:
        return _na("false-retrieval", "binary", slice_=slice_)
    returned = 1.0 if len(list(ranked_ids)) > 0 else 0.0
    return MetricResult(
        name="false-retrieval",
        unit="binary",
        value=returned,
        numerator=returned,
        denominator=1.0,
        slice=slice_,
    )


# --- Citations (structural) --------------------------------------------------
def citation_structural_validity(
    citations: Sequence[ObservedCitation], allowed_sources: Sequence[str], *, slice_: str = ""
) -> MetricResult:
    """Fraction of citations whose id is known and allowed.

    Structural validity is a 100%-per-case hard gate: any forged/forbidden id
    fails the case. Not-applicable when there are no citations to check.
    """
    allowed = set(allowed_sources)
    if not citations:
        return _na("citation-structural-validity", "ratio", slice_=slice_)
    valid = sum(1 for c in citations if c.incident_id in allowed)
    return MetricResult(
        name="citation-structural-validity",
        unit="ratio",
        value=valid / len(citations),
        numerator=valid,
        denominator=len(citations),
        slice=slice_,
    )


def forged_citation_count(
    citations: Sequence[ObservedCitation], allowed_sources: Sequence[str], *, slice_: str = ""
) -> MetricResult:
    """Count of citations pointing at an unknown or forbidden incident id."""
    allowed = set(allowed_sources)
    forged = sum(1 for c in citations if c.incident_id not in allowed)
    return MetricResult(
        name="forged-citations",
        unit="count",
        value=float(forged),
        numerator=float(forged),
        denominator=1.0,
        slice=slice_,
    )


def citation_structural_coverage(
    operational_claims: Sequence[RequiredClaim],
    citations: Sequence[ObservedCitation],
    *,
    slice_: str = "",
) -> MetricResult:
    """Fraction of operational claims that carry at least one citation.

    Structural (not semantic): it checks that a claim requiring evidence is
    *linked* to a source, not that the source truly supports it (that is the
    judge's job). Not-applicable when no claim requires evidence.
    """
    if not operational_claims:
        return _na("citation-structural-coverage", "ratio", slice_=slice_)
    cited_claim_ids = {c.claim_id for c in citations if c.claim_id is not None}
    covered = sum(1 for claim in operational_claims if claim.claim_id in cited_claim_ids)
    return MetricResult(
        name="citation-structural-coverage",
        unit="ratio",
        value=covered / len(operational_claims),
        numerator=covered,
        denominator=len(operational_claims),
        slice=slice_,
    )


# --- Convenience: the full deterministic retrieval + citation block ----------
def deterministic_metrics(
    *,
    pre_filter_ids: Sequence[str],
    post_filter_ids: Sequence[str],
    citations: Sequence[ObservedCitation],
    expected: Expected,
    k: int,
    slice_: str = "",
) -> list[MetricResult]:
    """Compute every deterministic metric for one case, pre and post filter."""
    gold = expected.gold_relevance()
    allowed = expected.allowed_sources
    results: list[MetricResult] = []
    for stage, ranked in (("pre", pre_filter_ids), ("post", post_filter_ids)):
        stage_slice = f"{slice_}/{stage}" if slice_ else stage
        results += [
            precision_at_k(ranked, gold, k=k, slice_=stage_slice),
            recall_at_k(ranked, gold, k=k, slice_=stage_slice),
            hit_at_k(ranked, gold, k=k, slice_=stage_slice),
            mrr(ranked, gold, slice_=stage_slice),
            ndcg_at_k(ranked, gold, k=k, slice_=stage_slice),
            false_retrieval_rate(ranked, gold, slice_=stage_slice),
        ]
    results += [
        citation_structural_validity(citations, allowed, slice_=slice_),
        forged_citation_count(citations, allowed, slice_=slice_),
        citation_structural_coverage(expected.operational_claims(), citations, slice_=slice_),
    ]
    return results
