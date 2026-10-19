"""Request/response schemas for the RAG suggestion endpoint.

The response is intentionally *transparent*: it reports the seven pipeline
steps (load, AI summary, embedding, three-layer retrieval, context, suggestion
with sources, publication) and the procedência gate, each with what it decided,
plus every retrieved candidate with its similarity score and post-filter
verdict. That step-by-step is a teaching goal of the project, not just an answer.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from .incident import Priority
from .work_note import WorkNote


class Classification(StrEnum):
    """Verdict on whether a new ticket is a genuine incident.

    * ``PROCEDENTE``: a real technical incident that needs operations work.
      It may or may not have a grounded suggestion (see ``SuggestResponse``).
    * ``IMPROCEDENTE``: not an incident: a self-service request, a how-to
      question or an access/password reset (e.g. "esqueci minha senha").
    """

    PROCEDENTE = "PROCEDENTE"
    IMPROCEDENTE = "IMPROCEDENTE"


class SuggestRequest(BaseModel):
    """A new incident to analyze. Only the two text fields are required.

    When ``number`` names an incident in the base, step 1 loads that record
    (its categoria, subcategoria, empresa and tags win over the request) and
    step 7 publishes the suggestion on its work notes.
    """

    number: str | None = Field(default=None, description="Incident to load and publish to.")
    short_description: str = Field(min_length=1, description="One-line problem summary.")
    description: str = Field(min_length=1, description="Full problem details.")
    category: str | None = Field(default=None, description="Optional pre-filter hint.")
    subcategory: str | None = Field(default=None, description="Optional subcategory.")
    empresa: str | None = Field(default=None, description="Group company; defaults to the bank.")
    cmdb_ci: str | None = Field(default=None, description="Optional affected service.")
    priority: Priority | None = None
    model: str | None = Field(
        default=None,
        description="Optional UI model id (see SELECTABLE_MODELS); unknown ids "
        "fall back to the default model.",
    )


class RetrievedCandidate(BaseModel):
    """A past resolved incident returned by vector search, with transparency."""

    number: str
    short_description: str
    cmdb_ci: str
    category: str
    # Cosine similarity to the query (higher = closer). Surfaced for didactics.
    similarity: float = Field(description="Cosine similarity in [-1, 1].")
    resolution_notes: str | None = None
    close_code: str | None = None
    # Whether the LLM post-filter kept this candidate as truly relevant.
    survived_postfilter: bool = True
    postfilter_reason: str | None = Field(
        default=None, description="Why the post-filter kept or dropped it."
    )


class RetrievedProblem(BaseModel):
    """A Problem record that passed the similarity floor, with its verdict."""

    number: str
    short_description: str
    root_cause: str
    workaround: str
    permanent_fix: str
    linked_incidents: int = Field(description="How many incidents this Problem explains.")
    similarity: float
    survived_postfilter: bool = True
    postfilter_reason: str | None = None


class StepStatus(StrEnum):
    """How a pipeline step ended."""

    DONE = "concluida"
    SKIPPED = "pulada"
    FALLBACK = "degradada"


StepId = Literal[
    "carregar", "resumir", "embedding", "recuperar", "contexto", "decidir", "sugerir", "publicar"
]


class PipelineStep(BaseModel):
    """One step of the article's pipeline and what it decided."""

    id: StepId
    order: int = Field(description="Step number in the article (1 to 7).")
    title: str
    status: StepStatus
    decision: str = Field(description="What this step decided, in PT-BR.")
    gate: bool = Field(default=False, description="True for the procedência decision.")


class TagLayer(BaseModel):
    """Layer 1: semantic tags decide where to search."""

    tags: list[str]
    source: Literal["incidente", "ia", "catalogo", "nenhuma"]
    filter_applied: bool
    decision: str


class VectorHit(BaseModel):
    """A raw vector-search hit and whether it cleared the cosine floor."""

    number: str
    kind: Literal["incidente", "problema"]
    short_description: str
    similarity: float
    passed: bool


class VectorLayer(BaseModel):
    """Layer 2: the vector measures what looks alike."""

    min_similarity: float
    incident_top_k: int
    problem_top_k: int
    incidents: list[VectorHit]
    problems: list[VectorHit]
    decision: str


class PostFilterVerdict(BaseModel):
    """The LLM's keep/drop verdict for one candidate."""

    number: str
    kind: Literal["incidente", "problema"]
    kept: bool
    reason: str


class PostFilterLayer(BaseModel):
    """Layer 3: the LLM post-filters what actually helps.

    ``fallback`` means the post-filter failed and the original list was kept,
    so the pipeline degrades precision instead of failing.
    """

    status: Literal["ok", "fallback", "sem_candidatos"]
    verdicts: list[PostFilterVerdict]
    fallback_reason: str | None = None
    decision: str


class RetrievalTrace(BaseModel):
    """The three retrieval layers, in order."""

    tags: TagLayer
    vector: VectorLayer
    postfilter: PostFilterLayer


class ProcedenciaDecision(BaseModel):
    """The gate between context and suggestion."""

    classification: Classification
    justification: str
    generates_suggestion: bool
    decision: str


class CitationFlag(BaseModel):
    """A cited id that is not in the retrieved context."""

    id: str
    action: Literal["removida", "sinalizada"] = Field(
        description="'removida' for a bracketed citation, 'sinalizada' for a bare mention."
    )


class CitationCheck(BaseModel):
    """Validation of the ids the suggestion cites against the context."""

    cited: list[str] = Field(default_factory=list, description="Valid cited ids, in order.")
    flagged: list[CitationFlag] = Field(default_factory=list)


class Publication(BaseModel):
    """Step 7: the suggestion written back to the incident."""

    published: bool
    incident_number: str | None = None
    note: WorkNote | None = None
    decision: str


class SuggestResponse(BaseModel):
    """The full result of the suggestion pipeline."""

    incident_number: str | None = Field(default=None, description="Loaded incident, if any.")
    summarized_query: str = Field(description="AI summary of the incident (step 2).")
    query_text: str = Field(
        default="", description="What was embedded: summary + categoria, subcategoria, empresa."
    )
    classification: Classification
    suggestion: str | None = Field(
        default=None,
        description=(
            "Grounded resolution in simple markdown. Null when IMPROCEDENTE or "
            "when PROCEDENTE has no similar past case to ground on."
        ),
    )
    candidates: list[RetrievedCandidate] = Field(
        default_factory=list, description="Retrieved candidates, scored and filtered."
    )
    referenced_incidents: list[str] = Field(
        default_factory=list,
        description="Numbers of the candidates that grounded the suggestion.",
    )
    problems: list[RetrievedProblem] = Field(
        default_factory=list, description="Problems that passed the floor, with verdicts."
    )
    referenced_problems: list[str] = Field(default_factory=list)
    context_ids: list[str] = Field(
        default_factory=list, description="Every id in the context handed to the suggestion."
    )
    steps: list[PipelineStep] = Field(default_factory=list)
    retrieval: RetrievalTrace
    decision: ProcedenciaDecision
    citations: CitationCheck = Field(default_factory=CitationCheck)
    publication: Publication
