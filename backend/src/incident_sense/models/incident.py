"""The core incident record, modeled after a ServiceNow-style ticket.

All fields use plain, well-known names so the data reads like a real ITSM
export — but every value in this project is synthetic.
"""

from __future__ import annotations

from datetime import datetime
from enum import IntEnum, StrEnum

from pydantic import BaseModel, Field


class IncidentState(StrEnum):
    """Lifecycle state of a ticket."""

    NEW = "New"
    IN_PROGRESS = "In Progress"
    ON_HOLD = "On Hold"
    RESOLVED = "Resolved"
    CLOSED = "Closed"


class Priority(IntEnum):
    """Ticket priority (1 = most urgent), ServiceNow-style."""

    CRITICAL = 1
    HIGH = 2
    MODERATE = 3
    LOW = 4


class Impact(IntEnum):
    """How widespread the effect is (1 = high)."""

    HIGH = 1
    MEDIUM = 2
    LOW = 3


class Urgency(IntEnum):
    """How time-sensitive the resolution is (1 = high)."""

    HIGH = 1
    MEDIUM = 2
    LOW = 3


# States in which an incident carries a usable resolution (the RAG knowledge
# base is built from these).
RESOLVED_STATES = frozenset({IncidentState.RESOLVED, IncidentState.CLOSED})


class Incident(BaseModel):
    """A single IT incident ticket."""

    number: str = Field(description="Ticket id, e.g. INC0012345.", examples=["INC0012345"])
    short_description: str = Field(description="One-line summary of the problem.")
    description: str = Field(description="Free-text details as reported.")

    category: str = Field(description="Top-level category, e.g. 'Pagamentos'.")
    subcategory: str = Field(description="Finer category, e.g. 'Pix'.")
    cmdb_ci: str = Field(description="Affected configuration item / service.")
    assignment_group: str = Field(description="Team the ticket is routed to.")

    priority: Priority
    impact: Impact
    urgency: Urgency
    state: IncidentState

    opened_at: datetime
    resolved_at: datetime | None = None
    closed_at: datetime | None = None

    resolution_notes: str | None = Field(
        default=None, description="How it was fixed; present once resolved/closed."
    )
    close_code: str | None = Field(
        default=None, description="Closure category, e.g. 'Solved (Permanently)'."
    )
    work_notes: str | None = Field(default=None, description="Investigation notes.")
    tags: list[str] = Field(default_factory=list, description="Free-form labels.")

    @property
    def is_resolved(self) -> bool:
        """True when the ticket is resolved/closed and carries resolution notes.

        Only these incidents are useful as RAG knowledge — an open ticket has no
        known fix to suggest.
        """
        return self.state in RESOLVED_STATES and bool(self.resolution_notes)
