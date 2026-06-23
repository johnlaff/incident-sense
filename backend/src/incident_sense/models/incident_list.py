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


class IncidentDetail(Incident):
    """A full incident record plus its recurrence-cluster assignment.

    The cluster fields are joined from the committed clustering result so the
    record view can tie an incident to its recurrence group (and surface peers).
    They are ``null`` when no clustering result is available for the incident.
    """

    cluster_id: int | None = Field(default=None, description="Recurrence cluster id, or null.")
    cluster_label: str | None = Field(
        default=None, description="Human-readable cluster name, or null."
    )
    is_outlier: bool | None = Field(
        default=None, description="True when the incident is clustering noise."
    )

    @classmethod
    def from_incident(cls, incident: Incident, point: object | None = None) -> IncidentDetail:
        """Build a detail record, joining a cluster point when present.

        ``point`` is a :class:`~incident_sense.models.cluster.ClusterPoint` (kept
        loosely typed here to avoid a circular import); only its cluster fields
        are read.
        """
        cluster_id = getattr(point, "cluster_id", None)
        cluster_label = getattr(point, "cluster_label", None)
        is_outlier = getattr(point, "is_outlier", None)
        return cls(
            **incident.model_dump(),
            cluster_id=cluster_id,
            cluster_label=cluster_label,
            is_outlier=is_outlier,
        )
