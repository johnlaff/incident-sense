"""Typed contract for the eval harness: dataset, execution and artifacts.

PROTOTYPE. These Pydantic models are the *canonical contract* the research (#16)
and the normative eval contract (#20) call for — the harness owns them, not a
third-party framework. Everything downstream (adapters, metrics, runner, writers)
speaks these types and nothing else, so a library swap never reaches the gate.

Two families of models live here:

* **Dataset** — ``EvalCase`` / ``Expected`` / ``EvalManifest``: the versioned,
  hashed corpus. The statistical unit is a *conversation* (``EvalCase``), even
  when single-turn.
* **Observation** — ``EvalExecution`` (what a ``TargetAdapter`` returns),
  ``MetricResult``, ``JudgeResult``, ``CaseResult`` and ``EvalRun``: the
  provider-neutral envelope. Provider extensions live in isolated fields; absent
  telemetry stays ``None`` and is never inferred from the requested name.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "eval-case/v1"
HARNESS_VERSION = "eval-harness-proto/v1"

Locale = Literal["pt-BR", "en"]
Severity = Literal["P0", "P1", "P2", "P3"]
Provenance = Literal["archetype", "synthetic", "regression", "threat-model"]


# --- Dataset -----------------------------------------------------------------
class Route(StrEnum):
    """The routing decision a turn is expected to take (#20, §7 / research)."""

    ANSWER_GENERAL = "answer-general"
    RETRIEVE_AND_ANSWER = "retrieve-and-answer"
    ANSWER_WITHOUT_HISTORICAL_SUGGESTION = "answer-without-historical-suggestion"
    REFUSE = "refuse"
    REQUEST_CLARIFICATION = "request-clarification"


class Refusal(StrEnum):
    """Whether a case must, must-not, or may refuse."""

    MUST_REFUSE = "must-refuse"
    MUST_NOT_REFUSE = "must-not-refuse"
    EITHER = "either"


class ClaimKind(StrEnum):
    """Claim classes that decide which evidence a claim needs (research §metrics)."""

    OPERATIONAL = "operational"  # diagnosis/cause/command/step — requires a source
    INCIDENT_FACT = "incident-fact"  # fact of the incident under analysis
    GENERAL_EXPLANATION = "general-explanation"  # concept — allowed without history


class Turn(BaseModel):
    """One conversational turn."""

    role: Literal["user", "assistant"]
    content: str


class GradedEvidence(BaseModel):
    """A gold-relevant historical incident with a graded relevance (#20: 0-2)."""

    incident_id: str
    # 0 = irrelevant; 1 = related but insufficient to ground; 2 = direct evidence.
    relevance: int = Field(ge=0, le=2)


class RequiredClaim(BaseModel):
    """A claim the answer must make, with the rubric that grades it."""

    claim_id: str
    kind: ClaimKind
    rubric: str


class Expected(BaseModel):
    """The gold expectation for a case — never the full expected prose."""

    route: Route
    relevant_evidence: list[GradedEvidence] = Field(default_factory=list)
    required_claims: list[RequiredClaim] = Field(default_factory=list)
    # Sources a citation may point at: the incident under analysis + approved gold.
    allowed_sources: list[str] = Field(default_factory=list)
    forbidden_sources: list[str] = Field(default_factory=list)
    refusal: Refusal = Refusal.MUST_NOT_REFUSE

    def gold_relevance(self) -> dict[str, int]:
        """Map incident_id -> graded relevance, for retrieval metrics."""
        return {e.incident_id: e.relevance for e in self.relevant_evidence}

    def operational_claims(self) -> list[RequiredClaim]:
        """Claims that require at least one citation."""
        return [c for c in self.required_claims if c.kind == ClaimKind.OPERATIONAL]


class EvalCase(BaseModel):
    """One evaluation conversation — the statistical unit of the corpus."""

    schema_version: str = SCHEMA_VERSION
    case_id: str
    locale: Locale
    # Links a PT-BR case to its semantic English twin. Not machine-translated gold.
    pair_id: str | None = None
    family: str
    severity: Severity = "P2"
    incident_id: str  # the incident under analysis
    turns: list[Turn]
    expected: Expected
    provenance: Provenance = "synthetic"
    tags: list[str] = Field(default_factory=list)

    def first_user_message(self) -> str:
        """The first user turn — what the current single-turn pipeline consumes."""
        for turn in self.turns:
            if turn.role == "user":
                return turn.content
        return ""


class CaseFileEntry(BaseModel):
    """A dataset file listed in the manifest, with its content hash."""

    path: str  # relative to the manifest
    sha256: str
    count: int


class EvalManifest(BaseModel):
    """Versioned, hashed index of the corpus (integrity gate on load)."""

    schema_version: str = "eval-manifest/v1"
    harness_version: str = HARNESS_VERSION
    dataset_version: str
    created: str  # ISO 8601; passed in, never derived, so runs stay reproducible
    files: list[CaseFileEntry]
    counts: dict[str, int] = Field(default_factory=dict)
    notes: str = ""


# --- Observation (provider-neutral envelope) ---------------------------------
class RetrievalObservation(BaseModel):
    """Ranked incident ids before and after the post-filter, with scores.

    Kept separate so a healthy retriever is never blamed for an aggressive
    post-filter, or vice-versa (research §retrieval).
    """

    pre_filter_ids: list[str] = Field(default_factory=list)
    post_filter_ids: list[str] = Field(default_factory=list)
    scores: dict[str, float] = Field(default_factory=dict)


class ObservedCitation(BaseModel):
    """A citation as observed in the answer, typed by source kind."""

    incident_id: str
    claim_id: str | None = None
    source_kind: Literal["incident-under-analysis", "historical"] = "historical"


class AnswerObservation(BaseModel):
    """The answer as observed: route, classification, citations, refusal."""

    route: Route
    classification: str  # PROCEDENTE / IMPROCEDENTE / n/a
    refused: bool = False
    citations: list[ObservedCitation] = Field(default_factory=list)
    text_present: bool = False  # atomic answer: text only on a valid terminal
    # Full answer text — DIAGNOSTIC ONLY. Judges read it in memory; the public
    # artifact writer redacts it (research §artifacts: full content off by default).
    answer_text: str | None = None


class CallTelemetry(BaseModel):
    """Per external call: provenance preserved, absent fields stay None."""

    purpose: str
    model_requested: str | None = None
    model_effective: str | None = None
    provider: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    # OpenRouter usage accounting takes precedence; None (not zero) when unknown.
    cost_usd: float | None = None
    cost_source: Literal["reported", "estimated", "unknown"] = "unknown"


class EvalExecution(BaseModel):
    """What a TargetAdapter returns for one case — the unit metrics grade."""

    case_id: str
    target: str  # adapter name (in-process / http-sse / replay)
    retrieval: RetrievalObservation = Field(default_factory=RetrievalObservation)
    answer: AnswerObservation | None = None
    telemetry: list[CallTelemetry] = Field(default_factory=list)
    stage_latency_ms: dict[str, float] = Field(default_factory=dict)
    error: str | None = None  # transport/provider failure — NOT a bad answer

    def total_cost_usd(self) -> float:
        """Sum of reported/estimated call costs (unknown counted as 0 here)."""
        return sum(t.cost_usd or 0.0 for t in self.telemetry)


class MetricResult(BaseModel):
    """One metric outcome: value, its fraction, and applicability.

    ``value is None`` means ``not_applicable`` (e.g. zero-denominator) — never
    silently 0 or 1, which would let an empty gold masquerade as a perfect score.
    """

    name: str
    unit: str
    value: float | None
    numerator: float
    denominator: float
    slice: str = ""

    @property
    def not_applicable(self) -> bool:
        """True when the metric could not be computed (empty denominator)."""
        return self.value is None


class JudgeResult(BaseModel):
    """A semantic judge's verdict — a calibrated instrument, provenance kept."""

    metric: str
    rubric_version: str
    judge_requested: str
    judge_effective: str | None = None
    provider: str | None = None
    score: float | None = None
    label: str | None = None
    reason: str = ""
    error: str | None = None
    latency_ms: float | None = None
    cost_usd: float | None = None
    cost_source: Literal["reported", "estimated", "unknown"] = "unknown"


class GateStatus(StrEnum):
    """A gate can pass, fail, or be impossible to evaluate."""

    PASS = "pass"
    FAIL = "fail"
    NOT_RUN = "not-run"


class CaseResult(BaseModel):
    """Everything known about one case after execution + grading."""

    case_id: str
    locale: Locale
    family: str
    severity: Severity
    execution: EvalExecution
    metrics: list[MetricResult] = Field(default_factory=list)
    judge_results: list[JudgeResult] = Field(default_factory=list)
    gates: dict[str, GateStatus] = Field(default_factory=dict)

    def failed_gates(self) -> list[str]:
        """Names of gates this case failed."""
        return [name for name, status in self.gates.items() if status == GateStatus.FAIL]


class EvalRun(BaseModel):
    """The full run: manifest, per-case results, aggregates and verdict."""

    harness_version: str = HARNESS_VERSION
    dataset_version: str
    started: str
    target: str
    results: list[CaseResult] = Field(default_factory=list)
    aggregates: dict[str, float] = Field(default_factory=dict)
    budget_cap_usd: float = 0.0
    budget_spent_usd: float = 0.0
    budget_reserved_usd: float = 0.0
    aborted_on_budget: bool = False
    verdict: GateStatus = GateStatus.NOT_RUN

    def gate_failures(self) -> dict[str, list[str]]:
        """Map failing gate -> case_ids that failed it (the vector of gates)."""
        failures: dict[str, list[str]] = {}
        for result in self.results:
            for name in result.failed_gates():
                failures.setdefault(name, []).append(result.case_id)
        return failures
