"""Response schemas for browsing the incident repertoire.

The list endpoint returns lean summaries (the columns a table needs); the detail
endpoint returns the full :class:`Incident`.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .incident import Incident


class IncidentSummary(BaseModel):
    """The subset of incident fields a list/table row needs."""

    number: str
    short_description: str
    category: str
    cmdb_ci: str
    assignment_group: str
    priority: int
    state: str
    opened_at: datetime
    resolved_at: datetime | None = None
    is_resolved: bool
    tags: list[str] = Field(default_factory=list)

    @classmethod
    def from_incident(cls, incident: Incident) -> IncidentSummary:
        """Project a full incident down to a list summary."""
        return cls(
            number=incident.number,
            short_description=incident.short_description,
            category=incident.category,
            cmdb_ci=incident.cmdb_ci,
            assignment_group=incident.assignment_group,
            priority=int(incident.priority),
            state=str(incident.state),
            opened_at=incident.opened_at,
            resolved_at=incident.resolved_at,
            is_resolved=incident.is_resolved,
            tags=incident.tags,
        )


class IncidentListResponse(BaseModel):
    """A page of incident summaries plus facets for the filter UI."""

    total: int = Field(description="Total matches before pagination.")
    items: list[IncidentSummary]
    services: list[str] = Field(description="Distinct affected services (for filtering).")
    open_count: int
    resolved_count: int
