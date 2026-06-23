"""In-memory incident repository: load once, filter for the browse UI.

The committed dataset is small (~430 incidents), so a simple in-memory filter is
plenty and keeps the browse endpoints dependency-free and instant.
"""

from __future__ import annotations

from typing import Literal

from incident_sense.config import get_settings
from incident_sense.data.loader import load_incidents
from incident_sense.data.precomputed import load_clusters_response
from incident_sense.models import ClusterPoint, Incident, IncidentState
from incident_sense.models.incident_list import IncidentListResponse, IncidentSummary

StateGroup = Literal["open", "resolved", "all"]

# "Open" = anything not yet resolved/closed.
_OPEN_STATES = frozenset({IncidentState.NEW, IncidentState.IN_PROGRESS, IncidentState.ON_HOLD})


class IncidentRepository:
    """Holds incidents in memory and answers list/detail queries."""

    def __init__(
        self, incidents: list[Incident], clusters: dict[str, ClusterPoint] | None = None
    ) -> None:
        # Most-recent first — the natural reading order for a queue.
        self._incidents = sorted(incidents, key=lambda i: i.opened_at, reverse=True)
        self._by_number = {i.number: i for i in self._incidents}
        self._services = sorted({i.cmdb_ci for i in self._incidents})
        self._clusters = clusters or {}

    def get(self, number: str) -> Incident | None:
        """Return the full incident, or None if unknown."""
        return self._by_number.get(number)

    def get_cluster(self, number: str) -> ClusterPoint | None:
        """Return the incident's clustering point, or None if not clustered."""
        return self._clusters.get(number)

    def list(
        self,
        *,
        state_group: StateGroup = "all",
        service: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> IncidentListResponse:
        """Filter, paginate, and summarize incidents for the table."""
        matches = [
            inc
            for inc in self._incidents
            if _in_state_group(inc, state_group)
            and (service is None or inc.cmdb_ci == service)
            and _matches_query(inc, query)
        ]
        page = matches[offset : offset + limit]
        return IncidentListResponse(
            total=len(matches),
            items=[IncidentSummary.from_incident(inc) for inc in page],
            services=self._services,
            open_count=sum(1 for inc in self._incidents if inc.state in _OPEN_STATES),
            resolved_count=sum(1 for inc in self._incidents if inc.is_resolved),
        )


def _in_state_group(incident: Incident, group: StateGroup) -> bool:
    if group == "open":
        return incident.state in _OPEN_STATES
    if group == "resolved":
        return incident.is_resolved
    return True


def _matches_query(incident: Incident, query: str | None) -> bool:
    if not query:
        return True
    needle = query.lower()
    haystack = f"{incident.number} {incident.short_description} {incident.description}".lower()
    return needle in haystack


def _load_cluster_index() -> dict[str, ClusterPoint]:
    """Index the committed clustering points by incident number.

    Returns an empty index (so detail still works) when the result is missing.
    """
    try:
        response = load_clusters_response(get_settings().clusters_path)
    except FileNotFoundError:
        return {}
    return {point.id: point for point in response.points}


def build_repository() -> IncidentRepository:
    """Build a repository from the committed dataset, joined with clustering."""
    return IncidentRepository(load_incidents(), _load_cluster_index())
