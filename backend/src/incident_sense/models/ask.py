"""A follow-up question about an incident's analysis, and its answer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .suggest import CitationCheck

AskKind = Literal["answer", "not_in_cases", "off_topic"]


class AskRequest(BaseModel):
    """What the person typed, and the cases the analysis kept."""

    question: str = Field(min_length=1, max_length=600)
    context_ids: list[str] = Field(
        default_factory=list,
        max_length=20,
        description=(
            "Sent by older clients and ignored: the server holds the kept cases of "
            "this visitor's last analysis."
        ),
    )
    model: str | None = Field(default=None, description="Optional UI model id.")


class AskResponse(BaseModel):
    """One answer, grounded on the incident and the kept cases. Never published."""

    kind: AskKind = Field(
        description=(
            "answer | not_in_cases (the cases do not say) | off_topic (not about this incident)"
        )
    )
    answer: str
    citations: CitationCheck = Field(default_factory=CitationCheck)
    context_ids: list[str] = Field(
        default_factory=list, description="The ids actually used as context."
    )
