"""Browse the incident repertoire: list with filters + open a full record.

These power the ServiceNow-like incident table and detail view, and let the user
open any incident the AI cites to verify the suggestion's grounding.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from incident_sense.data.repository import IncidentRepository, StateGroup, build_repository
from incident_sense.models import Incident
from incident_sense.models.incident_list import IncidentListResponse

router = APIRouter(tags=["incidents"])


@lru_cache
def _cached_repository() -> IncidentRepository:
    return build_repository()


def get_incident_repository() -> IncidentRepository:
    """Provide the (cached) incident repository; overridable in tests."""
    return _cached_repository()


RepoDep = Annotated[IncidentRepository, Depends(get_incident_repository)]


@router.get("/incidents", response_model=IncidentListResponse)
def list_incidents(
    repo: RepoDep,
    state: StateGroup = "all",
    service: Annotated[str | None, Query(description="Filter by affected service.")] = None,
    q: Annotated[str | None, Query(description="Search number/description.")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> IncidentListResponse:
    """List incidents, filtered by state group, service and a text query."""
    return repo.list(state_group=state, service=service, query=q, limit=limit, offset=offset)


@router.get("/incidents/{number}", response_model=Incident)
def get_incident(number: str, repo: RepoDep) -> Incident:
    """Return a single incident's full record, or 404."""
    incident = repo.get(number)
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Incidente {number} não encontrado.",
        )
    return incident
