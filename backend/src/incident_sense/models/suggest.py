"""Request/response schemas for the RAG suggestion endpoint.

The response is intentionally *transparent*: it surfaces the summarized query,
every retrieved candidate with its similarity score, and whether each survived
the LLM post-filter. That step-by-step is a teaching goal of the project, not
just an answer.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from .incident import Priority


class Classification(StrEnum):
    """Verdict for a new incident.

    * ``PROCEDENTE`` — a relevant known resolution exists; we can suggest a fix.
    * ``IMPROCEDENTE`` — no actionable operational match (e.g. a password reset).
    """

    PROCEDENTE = "PROCEDENTE"
    IMPROCEDENTE = "IMPROCEDENTE"


class SuggestRequest(BaseModel):
    """A new incident to analyze. Only the two text fields are required."""

    short_description: str = Field(min_length=1, description="One-line problem summary.")
    description: str = Field(min_length=1, description="Full problem details.")
    category: str | None = Field(default=None, description="Optional pre-filter hint.")
    cmdb_ci: str | None = Field(default=None, description="Optional affected service.")
    priority: Priority | None = None


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


class SuggestResponse(BaseModel):
    """The full result of the suggestion pipeline."""

    summarized_query: str = Field(description="LLM-condensed retrieval query.")
    classification: Classification
    suggestion: str | None = Field(
        default=None, description="Grounded resolution; null when IMPROCEDENTE."
    )
    candidates: list[RetrievedCandidate] = Field(
        default_factory=list, description="Retrieved candidates, scored and filtered."
    )
    referenced_incidents: list[str] = Field(
        default_factory=list,
        description="Numbers of the candidates that grounded the suggestion.",
    )
