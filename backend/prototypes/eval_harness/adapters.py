"""TargetAdapter: how the harness drives the system under test.

PROTOTYPE. The port is ``TargetAdapter.run(case) -> EvalExecution``. Three
implementations are sketched, in the order the research recommends building them:

* ``InProcessRagTarget`` — **implemented**. Drives the real ``run_suggestion``
  pipeline with the codebase's own fakes (``fixtures.Scenario``). No network, no
  cost, fully deterministic. This is what validates the harness core today.
* ``ReplayTarget`` — **implemented**. Returns a previously recorded execution,
  so metrics and rubrics can be re-scored without repeating paid calls.
* ``HttpSseTarget`` — **stub**. The shape the real release-candidate target will
  take against ``POST /api/incidents/{n}/copilot/turns`` once that endpoint (#18)
  exists. Raising here keeps the prototype honest about what is not built yet.

Provider-neutrality: the adapter maps the product's ``SuggestResponse`` into the
harness envelope (``EvalExecution``); nothing downstream sees an SDK object.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from incident_sense.config import Settings
from incident_sense.models import Classification, SuggestRequest, SuggestResponse
from incident_sense.rag import pipeline

from . import pricing
from .fixtures import SCENARIOS, Scenario
from .schema import (
    AnswerObservation,
    CallTelemetry,
    EvalCase,
    EvalExecution,
    ObservedCitation,
    RetrievalObservation,
    Route,
)

# The current pipeline emits citations only as ``[INC...]`` tokens in Markdown.
# The future conversational contract (#18) emits structured citations; parsing
# the Markdown is a PROTOTYPE stand-in, flagged so it is not mistaken for the
# real structural source of truth.
_CITATION = re.compile(r"\[(INC\d+)\]")


class TargetAdapter(Protocol):
    """Run one eval case against the system under test, return the observation."""

    name: str

    async def run(self, case: EvalCase) -> EvalExecution:
        """Execute the case and return a provider-neutral ``EvalExecution``."""
        ...


def _route_of(response: SuggestResponse) -> Route:
    """Map the current pipeline's outcome onto the conversational route vocab.

    A PROTOTYPE approximation: the single-turn pipeline cannot reach
    ``answer-general`` or ``request-clarification`` — cases expecting those will
    show as a route mismatch, which is the honest signal that the endpoint (#18)
    is required, not a harness bug.
    """
    if response.classification == Classification.IMPROCEDENTE:
        return Route.REFUSE
    if response.suggestion:
        return Route.RETRIEVE_AND_ANSWER
    return Route.ANSWER_WITHOUT_HISTORICAL_SUGGESTION


def _citations_of(response: SuggestResponse) -> list[ObservedCitation]:
    """Extract ``[INC...]`` citations from the Markdown suggestion (stand-in)."""
    if not response.suggestion:
        return []
    seen: list[ObservedCitation] = []
    for match in _CITATION.finditer(response.suggestion):
        incident_id = match.group(1)
        # claim_id stays None: the current pipeline has no claim structure; the
        # future contract links each citation to a claim block.
        seen.append(ObservedCitation(incident_id=incident_id, source_kind="historical"))
    return seen


def _telemetry_of(case: EvalCase, response: SuggestResponse, model: str) -> list[CallTelemetry]:
    """Estimate per-turn telemetry. Fakes make no real call, so cost is estimated."""
    prompt = case.first_user_message() + response.summarized_query
    input_tokens = pricing.estimate_tokens(prompt)
    output_tokens = pricing.estimate_tokens(response.suggestion or " ")
    return [
        CallTelemetry(
            purpose="turn",
            model_requested=model,
            model_effective=model,  # fake: requested == effective
            provider="openrouter(fake)",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=pricing.estimate_cost_usd(
                model, input_tokens=input_tokens, output_tokens=output_tokens
            ),
            cost_source="estimated",
        )
    ]


class InProcessRagTarget:
    """Drive the real RAG pipeline with scripted fakes (no network, no cost)."""

    name = "in-process"

    def __init__(self, *, model: str = "deepseek/deepseek-v4-flash") -> None:
        self._model = model
        self._settings = Settings()

    async def run(self, case: EvalCase) -> EvalExecution:
        """Run the case's scenario through ``run_suggestion`` and map the result."""
        scenario = SCENARIOS.get(case.case_id)
        if scenario is None:
            return EvalExecution(
                case_id=case.case_id,
                target=self.name,
                error=f"no scenario fixture for case {case.case_id!r}",
            )
        return self._execute(case, scenario)

    def _execute(self, case: EvalCase, scenario: Scenario) -> EvalExecution:
        request = SuggestRequest(
            short_description=scenario.title,
            description=case.first_user_message(),
            category=scenario.category,
            cmdb_ci=scenario.cmdb_ci,
        )
        response = pipeline.run_suggestion(request, scenario.deps(), self._settings)

        # ``response.candidates`` is ordered survivors-first (the post-filter sorts
        # it), so it is NOT the raw retriever ranking. Pre-filter retrieval metrics
        # must see the raw ranking by score; post-filter sees the survivors (whose
        # relative score order the stable sort preserves). LIMITATION: sorting by
        # score cannot recover the raw order among *exact* score ties (the stable
        # sort keeps the survivors-first order there). The production fix is to
        # expose the raw pre-filter rank on the response (#18's retrieval event);
        # the demo corpus has no ties, so its metrics are unaffected.
        by_score = sorted(response.candidates, key=lambda c: c.similarity, reverse=True)
        pre_ids = [c.number for c in by_score]
        post_ids = [c.number for c in response.candidates if c.survived_postfilter]
        scores = {c.number: c.similarity for c in response.candidates}

        answer = AnswerObservation(
            route=_route_of(response),
            classification=str(response.classification),
            refused=response.classification == Classification.IMPROCEDENTE,
            citations=_citations_of(response),
            text_present=response.suggestion is not None,
            answer_text=response.suggestion,  # diagnostic; redacted in public artifact
        )
        return EvalExecution(
            case_id=case.case_id,
            target=self.name,
            retrieval=RetrievalObservation(
                pre_filter_ids=pre_ids, post_filter_ids=post_ids, scores=scores
            ),
            answer=answer,
            telemetry=_telemetry_of(case, response, self._model),
            stage_latency_ms={"total": 0.0},  # in-process fakes: latency not meaningful
        )


class ReplayTarget:
    """Return a previously recorded execution — re-score without paying again."""

    name = "replay"

    def __init__(self, recorded: dict[str, EvalExecution]) -> None:
        self._recorded = recorded

    @classmethod
    def from_jsonl(cls, path: Path) -> ReplayTarget:
        """Load recorded executions (one ``EvalExecution`` JSON per line)."""
        recorded: dict[str, EvalExecution] = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            execution = EvalExecution.model_validate_json(line)
            recorded[execution.case_id] = execution
        return cls(recorded)

    async def run(self, case: EvalCase) -> EvalExecution:
        """Return the recorded execution for the case, or an explicit error."""
        execution = self._recorded.get(case.case_id)
        if execution is None:
            return EvalExecution(
                case_id=case.case_id,
                target=self.name,
                error=f"no recorded execution for case {case.case_id!r}",
            )
        return execution


class HttpSseTarget:
    """STUB — the release-candidate target once the copiloto endpoint (#18) exists.

    Shape it will take: open ``POST /api/incidents/{n}/copilot/turns`` with
    ``text/event-stream``, replay the case's turns, assert the typed SSE envelope
    (``turn.accepted`` → ``phase.changed`` → ``retrieval.completed`` →
    ``answer.completed`` | ``turn.failed`` | ``turn.cancelled``), and map the
    validated ``CopilotAnswer`` blocks (structured citations!) into
    ``EvalExecution``. Reserved for the protected RC job under the budget cap.
    """

    name = "http-sse"

    def __init__(self, base_url: str) -> None:
        self._base_url = base_url

    async def run(self, case: EvalCase) -> EvalExecution:
        """Not implemented: the conversational endpoint (#18) is not built yet."""
        raise NotImplementedError(
            "HttpSseTarget requires POST /api/incidents/{n}/copilot/turns (ticket #18); "
            "build it after the endpoint exists."
        )
