"""Browse the Problem records: list them and open one with its incidents.

A Problem holds the root cause of recurring incidents and the known fix. The
suggestion flow retrieves and cites them, so the UI lets the user open any one.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from incident_sense.api.incidents import RepoDep as IncidentRepoDep
from incident_sense.data.problem_repository import ProblemRepository, build_problem_repository
from incident_sense.models import ProblemDetail, ProblemSummary

router = APIRouter(tags=["problems"])


@lru_cache
def _cached_repository() -> ProblemRepository:
    return build_problem_repository()


def get_problem_repository() -> ProblemRepository:
    """Provide the (cached) Problem repository; overridable in tests."""
    return _cached_repository()


RepoDep = Annotated[ProblemRepository, Depends(get_problem_repository)]


@router.get("/problems", response_model=list[ProblemSummary])
def list_problems(repo: RepoDep) -> list[ProblemSummary]:
    """All Problems, in number order."""
    return repo.list()


@router.get("/problems/{number}", response_model=ProblemDetail)
def get_problem(number: str, repo: RepoDep, incidents: IncidentRepoDep) -> ProblemDetail:
    """One Problem with its linked incidents, or 404."""
    number = number.strip().upper()
    detail = repo.detail(number, incidents)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problema {number} não encontrado.",
        )
    return detail
