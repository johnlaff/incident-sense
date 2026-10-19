"""Changes: browse the requests and evaluate how well they were filled in.

``POST /api/changes/{number}/evaluate`` accepts edited field values from the UI,
so a visitor can rewrite a field and watch only that field go back to the model
(the content lock), without changing the record for anyone else.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from incident_sense.changes.evaluator import ChangeEvaluator, EvaluationCache, JudgeLLM
from incident_sense.changes.repository import ChangeRepository, load_changes
from incident_sense.changes.rubric import load_rubric
from incident_sense.config import get_settings, resolve_chat_model
from incident_sense.guard import ai_quota
from incident_sense.logging import get_logger
from incident_sense.models.change import (
    Change,
    ChangeSummary,
    EvaluateRequest,
    EvaluationResponse,
    Rubric,
)
from incident_sense.providers import make_chat_client
from incident_sense.rag.clients import OpenAILLMClient

router = APIRouter(tags=["changes"])

JudgeFactory = Callable[[str], JudgeLLM]
log = get_logger(__name__)


@lru_cache
def _cached_repository() -> ChangeRepository:
    return ChangeRepository(load_changes())


def get_change_repository() -> ChangeRepository:
    """The (cached) Change repository; overridable in tests."""
    return _cached_repository()


_cache = EvaluationCache()


def get_evaluation_cache() -> EvaluationCache:
    """The process-wide content lock; overridable in tests."""
    return _cache


def get_judge_factory() -> JudgeFactory:
    """Build judge LLM clients per model, or fail clearly without a key."""
    settings = get_settings()
    if not settings.has_llm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key is not configured. Set OPENROUTER_API_KEY to evaluate Changes.",
        )
    client = make_chat_client(settings)
    # The verdict must be in the visible answer: with reasoning on, a long Change
    # spends the whole output budget on hidden reasoning and returns no JSON.
    return lambda model: OpenAILLMClient(client, model, reasoning=False)


RepoDep = Annotated[ChangeRepository, Depends(get_change_repository)]


def _get(repo: ChangeRepository, number: str) -> Change:
    change = repo.get(number)
    if change is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Change {number} não encontrada."
        )
    return change


@router.get("/changes", response_model=list[ChangeSummary])
def list_changes(repo: RepoDep) -> list[ChangeSummary]:
    """All Changes, soonest window first."""
    return repo.list()


@router.get("/changes/rubric", response_model=Rubric)
def rubric() -> Rubric:
    """The versioned rubric the judge uses."""
    return load_rubric()


@router.get("/changes/{number}", response_model=Change)
def get_change(number: str, repo: RepoDep) -> Change:
    """One Change with every field, or 404."""
    return _get(repo, number)


@router.post(
    "/changes/{number}/evaluate",
    response_model=EvaluationResponse,
    dependencies=[Depends(ai_quota)],
)
def evaluate_change(
    number: str,
    request: EvaluateRequest,
    repo: RepoDep,
    cache: Annotated[EvaluationCache, Depends(get_evaluation_cache)],
    judge_for: Annotated[JudgeFactory, Depends(get_judge_factory)],
) -> EvaluationResponse:
    """Score the seven fields, then run the semantic analysis if eligible."""
    change = _get(repo, number)
    model = resolve_chat_model(request.model, get_settings())
    evaluator = ChangeEvaluator(judge_for(model), model=model, rubric=load_rubric(), cache=cache)
    try:
        return evaluator.evaluate(
            change, overrides=request.fields, backout_plan=request.backout_plan
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean, localized error.
        log.error("evaluate_failed", error=str(exc), error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível avaliar a Change agora. Tente de novo em instantes.",
        ) from exc
