"""The resolution-suggestion pipeline, one small step per function.

Flow (each step is independently testable and mock-friendly):

    summarize -> embed -> pre-filter -> retrieve -> post-filter
    -> classify -> (suggest) -> assemble response

Every retrieved candidate is reported back with its similarity score and whether
it survived the post-filter — surfacing the reasoning is a goal of the project.
"""

from __future__ import annotations

from typing import Any

from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from pydantic import BaseModel, ValidationError
from qdrant_client import models as qm

from incident_sense.config import Settings
from incident_sense.models import (
    Classification,
    RetrievedCandidate,
    SuggestRequest,
    SuggestResponse,
)
from incident_sense.providers import extract_json
from incident_sense.rag.clients import RagDeps, RetrievedHit
from incident_sense.rag.postfilter import LLMPostFilter

# --- Prompts -----------------------------------------------------------------
_SUMMARIZE_SYSTEM = (
    "Você condensa um chamado de incidente em uma consulta de busca curta, em "
    "português, contendo apenas os termos técnicos essenciais (sintoma, serviço "
    "afetado). Responda somente com a consulta, em uma linha."
)
_CLASSIFY_SYSTEM = (
    "Você decide se um novo incidente tem uma resolução conhecida aplicável, "
    "com base em incidentes passados relevantes. Responda apenas com JSON."
)
_SUGGEST_SYSTEM = (
    "Você é um analista sênior de operações de TI de um banco. Escreva uma "
    "sugestão de resolução objetiva em português, fundamentada apenas nas "
    "resoluções passadas fornecidas, citando entre colchetes os números dos "
    "incidentes que a embasaram (ex.: [INC0012345])."
)


def _incident_text(request: SuggestRequest) -> str:
    return f"{request.short_description}. {request.description}".strip()


# --- Step 1: summarize -------------------------------------------------------
def summarize_query(deps: RagDeps, request: SuggestRequest) -> str:
    """Condense the incident into a short retrieval query via the LLM."""
    user = (
        f"Título: {request.short_description}\n"
        f"Descrição: {request.description}\n\nConsulta de busca:"
    )
    out = deps.llm.complete(_SUMMARIZE_SYSTEM, user, temperature=0.0, max_tokens=80).strip()
    return out.splitlines()[0][:200] if out else request.short_description


# --- Step 2: embed -----------------------------------------------------------
def embed_query(deps: RagDeps, query: str) -> list[float]:
    """Embed the retrieval query."""
    return deps.embeddings.embed(query)


# --- Step 3: optional metadata pre-filter ------------------------------------
def build_prefilter(request: SuggestRequest) -> qm.Filter | None:
    """Narrow the search by category/cmdb_ci when those hints are provided.

    Uses ``should`` (logical OR): a candidate matching either hint qualifies.
    Returns ``None`` when no hints are given, so retrieval stays broad.
    """
    # Typed as Any because Qdrant's `should` expects an invariant union list.
    conditions: list[Any] = []
    if request.category:
        conditions.append(
            qm.FieldCondition(key="category", match=qm.MatchValue(value=request.category))
        )
    if request.cmdb_ci:
        conditions.append(
            qm.FieldCondition(key="cmdb_ci", match=qm.MatchValue(value=request.cmdb_ci))
        )
    return qm.Filter(should=conditions) if conditions else None


# --- Step 4: vector search ---------------------------------------------------
def retrieve(
    deps: RagDeps,
    vector: list[float],
    *,
    top_k: int,
    min_similarity: float,
    query_filter: qm.Filter | None,
) -> list[RetrievedHit]:
    """Top-k vector search, keeping only hits at/above the similarity floor."""
    hits = deps.retriever.search(vector, top_k=top_k, query_filter=query_filter)
    return [hit for hit in hits if hit.score >= min_similarity]


# --- Step 5: LLM post-filter -------------------------------------------------
def _to_nodes(hits: list[RetrievedHit]) -> list[NodeWithScore]:
    nodes: list[NodeWithScore] = []
    for hit in hits:
        metadata: dict[str, Any] = {**hit.payload, "number": hit.number, "similarity": hit.score}
        text = hit.payload.get("resolution_notes") or hit.payload.get("short_description", "")
        nodes.append(NodeWithScore(node=TextNode(text=text, metadata=metadata), score=hit.score))
    return nodes


def post_filter(
    deps: RagDeps, request: SuggestRequest, hits: list[RetrievedHit]
) -> list[NodeWithScore]:
    """Run the LlamaIndex post-filter, annotating each node with its verdict."""
    nodes = _to_nodes(hits)
    post_processor = LLMPostFilter(llm=deps.llm)
    processed = post_processor.postprocess_nodes(
        nodes, query_bundle=QueryBundle(query_str=_incident_text(request))
    )
    return list(processed)


# --- Step 6: classification (structured output) ------------------------------
class _ClassificationOut(BaseModel):
    """Schema the LLM classification is validated into."""

    classification: Classification
    justification: str = ""


def classify(
    deps: RagDeps, request: SuggestRequest, surviving: list[NodeWithScore]
) -> Classification:
    """PROCEDENTE if a relevant known resolution survived; else IMPROCEDENTE.

    With no surviving candidate there is nothing to ground a fix on, so we
    short-circuit to IMPROCEDENTE without spending an LLM call.
    """
    if not surviving:
        return Classification.IMPROCEDENTE

    listing = "\n".join(
        f"- {node.node.metadata.get('number', '')}: "
        f"{node.node.metadata.get('short_description', '')}"
        for node in surviving
    )
    user = (
        f"NOVO incidente:\n{_incident_text(request)}\n\n"
        f"Incidentes passados relevantes:\n{listing}\n\n"
        'Responda com JSON: {"classification": "PROCEDENTE" ou "IMPROCEDENTE", '
        '"justification": "..."}. PROCEDENTE = existe resolução conhecida '
        "aplicável; IMPROCEDENTE = não há correspondência acionável."
    )
    raw = deps.llm.complete(_CLASSIFY_SYSTEM, user, temperature=0.0, max_tokens=300)
    try:
        return _ClassificationOut.model_validate(extract_json(raw)).classification
    except (ValueError, ValidationError):
        # Surviving candidates exist but parsing failed: prefer the useful path.
        return Classification.PROCEDENTE


# --- Step 7: grounded suggestion ---------------------------------------------
def generate_suggestion(
    deps: RagDeps, request: SuggestRequest, surviving: list[NodeWithScore]
) -> str:
    """Write a resolution grounded in the surviving candidates' notes."""
    grounding = "\n\n".join(
        f"[{node.node.metadata.get('number', '')}] "
        f"{node.node.metadata.get('short_description', '')}\n"
        f"Resolução: {node.node.metadata.get('resolution_notes', '')}"
        for node in surviving
    )
    user = (
        f"NOVO incidente:\n{_incident_text(request)}\n\n"
        f"Resoluções passadas para fundamentar:\n{grounding}\n\n"
        "Escreva a sugestão de resolução:"
    )
    return deps.llm.complete(_SUGGEST_SYSTEM, user, temperature=0.3, max_tokens=700).strip()


# --- Orchestrator ------------------------------------------------------------
def _to_candidate(node: NodeWithScore) -> RetrievedCandidate:
    metadata = node.node.metadata
    return RetrievedCandidate(
        number=str(metadata.get("number", "")),
        short_description=str(metadata.get("short_description", "")),
        cmdb_ci=str(metadata.get("cmdb_ci", "")),
        category=str(metadata.get("category", "")),
        similarity=float(node.score or 0.0),
        resolution_notes=metadata.get("resolution_notes"),
        close_code=metadata.get("close_code"),
        survived_postfilter=bool(metadata.get("survived", True)),
        postfilter_reason=metadata.get("postfilter_reason"),
    )


def run_suggestion(request: SuggestRequest, deps: RagDeps, settings: Settings) -> SuggestResponse:
    """Run the full pipeline and assemble the transparent response."""
    query = summarize_query(deps, request)
    vector = embed_query(deps, query)
    query_filter = build_prefilter(request)
    hits = retrieve(
        deps,
        vector,
        top_k=settings.example_top_k,
        min_similarity=settings.example_min_similarity,
        query_filter=query_filter,
    )
    nodes = post_filter(deps, request, hits)
    surviving = [node for node in nodes if node.node.metadata.get("survived", True)]

    classification = classify(deps, request, surviving)
    suggestion: str | None = None
    referenced: list[str] = []
    if classification == Classification.PROCEDENTE and surviving:
        suggestion = generate_suggestion(deps, request, surviving)
        referenced = [str(node.node.metadata.get("number", "")) for node in surviving]

    return SuggestResponse(
        summarized_query=query,
        classification=classification,
        suggestion=suggestion,
        candidates=[_to_candidate(node) for node in nodes],
        referenced_incidents=referenced,
    )
