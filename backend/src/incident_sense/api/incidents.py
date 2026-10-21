"""Browse the incident repertoire: list with filters + open a full record.

These power the ServiceNow-like incident table and detail view, and let the user
open any incident the AI cites to verify the suggestion's grounding.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from incident_sense.data.repository import IncidentRepository, StateGroup, build_repository
from incident_sense.data.work_notes import WorkNotesStore, get_work_notes_store
from incident_sense.guard import client_key
from incident_sense.models.incident_list import IncidentDetail, IncidentListResponse

router = APIRouter(tags=["incidents"])


@lru_cache
def _cached_repository() -> IncidentRepository:
    return build_repository()


def get_incident_repository() -> IncidentRepository:
    """Provide the (cached) incident repository; overridable in tests."""
    return _cached_repository()


def get_work_notes() -> WorkNotesStore:
    """Provide the process-wide work notes store; overridable in tests."""
    return get_work_notes_store()


RepoDep = Annotated[IncidentRepository, Depends(get_incident_repository)]
NotesDep = Annotated[WorkNotesStore, Depends(get_work_notes)]


@router.get("/incidents", response_model=IncidentListResponse)
def list_incidents(
    repo: RepoDep,
    state: StateGroup = "all",
    service: Annotated[str | None, Query(description="Filter by affected service.")] = None,
    q: Annotated[str | None, Query(description="Search number/description.")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> IncidentListResponse:
    """List incidents, filtered by state group, service and a text query."""
    return repo.list(state_group=state, service=service, query=q, limit=limit, offset=offset)


@router.get("/incidents/{number}", response_model=IncidentDetail)
def get_incident(
    number: str,
    repo: RepoDep,
    notes: NotesDep,
    http: Request,
) -> IncidentDetail:
    """Return an incident's full record (cluster and published work notes), or 404."""
    number = number.strip().upper()
    incident = repo.get(number)
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Incidente {number} não encontrado.",
        )
    detail = IncidentDetail.from_incident(incident, repo.get_cluster(number))
    detail.published_notes = notes.list(number, client_id=client_key(http))
    return detail
