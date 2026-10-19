"""A work note published on an incident (step 7 of the suggestion pipeline)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class WorkNote(BaseModel):
    """A note attached to an incident's work notes by the platform."""

    id: str
    incident_number: str
    author: str = Field(description="Who published it; 'Aurora' for the AI suggestion.")
    text: str = Field(description="The note body (the suggestion, in simple markdown).")
    sources: list[str] = Field(
        default_factory=list, description="Incident and Problem ids that grounded it."
    )
    model: str | None = Field(default=None, description="Chat model that wrote it.")
    created_at: datetime
