"""Change records and the schemas of their LLM-as-judge evaluation.

A Change is the request to alter production, ServiceNow-style. Seven of its
free-text fields are scored against a versioned rubric; when the weighted score
reaches the eligibility threshold, a semantic analysis checks whether the
fields tell one coherent story and whether the backout plan matches the tasks.
Every value in this project is synthetic.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

EVALUATED_FIELDS: tuple[str, ...] = (
    "implementation_plan",
    "validation_plan",
    "objective",
    "benefits",
    "test_justification",
    "short_description",
    "prerequisites",
)


class ChangeTask(BaseModel):
    """A task registered under the Change (what will actually be executed)."""

    number: str
    short_description: str


class Change(BaseModel):
    """A single change request."""

    number: str = Field(examples=["CHG0031001"])
    type: str = Field(description="Normal, Standard or Emergency.")
    state: str = Field(description="New, Scheduled, Implement or Closed.")
    company: str
    cmdb_ci: str
    assignment_group: str
    risk: str
    requested_by: str
    planned_start: datetime
    planned_end: datetime

    short_description: str
    objective: str
    benefits: str
    prerequisites: str
    implementation_plan: str
    validation_plan: str
    test_justification: str
    backout_plan: str
    tasks: list[ChangeTask] = Field(default_factory=list)

    scenario: str = Field(default="", description="Demo label for the presenter.")
    scenario_note: str = ""
    plain_summary: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "One plain sentence per field card, for a reader new to ITSM. "
            "Shown above the field text; never sent to the judge."
        ),
    )


class ChangeSummary(BaseModel):
    """A Change as shown in the list."""

    number: str
    short_description: str
    type: str
    state: str
    company: str
    cmdb_ci: str
    risk: str
    planned_start: datetime
    in_scope: bool
    scenario: str
    plain: str = Field(
        default="",
        description="The title in plain words, for a reader new to ITSM (list line).",
    )


class RubricField(BaseModel):
    """One rubric line: a field, its weight and what a good fill contains."""

    key: str
    label: str
    weight: float
    criteria: list[str]


class Rubric(BaseModel):
    """The versioned rubric (see changes/rubrica.toml)."""

    version: str
    eligibility_threshold: float
    fields: list[RubricField]

    @property
    def total_weight(self) -> float:
        """Sum of the field weights (13.5 in the published rubric)."""
        return sum(field.weight for field in self.fields)


class EvaluateRequest(BaseModel):
    """Evaluate a Change, optionally with edited field values from the UI."""

    fields: dict[str, str] = Field(
        default_factory=dict,
        description="Edited values for any of the seven evaluated fields.",
    )
    backout_plan: str | None = None
    model: str | None = None
    fresh: bool = Field(
        default=False,
        description="Skip the content lock: every part goes back to the model.",
    )


class FieldScore(BaseModel):
    """The verdict on one field."""

    key: str
    label: str
    weight: float
    score: float | None = Field(
        default=None, ge=0, le=10, description="Null only when the AI could not judge it."
    )
    failed: bool = Field(default=False, description="True when the AI could not judge it.")
    diagnosis: str
    guidance: str = ""
    reused: bool = Field(description="True when the content lock skipped the model.")
    content_hash: str


class BackoutAdherence(StrEnum):
    """How well the backout plan matches the registered tasks."""

    ADERENTE = "ADERENTE"
    PARCIAL = "PARCIAL"
    NAO_ADERENTE = "NAO_ADERENTE"


class SemanticAnalysis(BaseModel):
    """Do the fields tell the same story? Runs only above the threshold."""

    consistency_score: float = Field(ge=0, le=10)
    problems: list[str] = Field(
        default_factory=list, description="Real contradictions between two parts."
    )
    attention: list[str] = Field(
        default_factory=list,
        description="Gaps and suggestions (pontos de atenção): never block the Change.",
    )
    reasoning: str
    guidance: str
    backout_adherence: BackoutAdherence
    backout_adherence_percent: int = Field(ge=0, le=100)
    reused: bool = False


class Decision(BaseModel):
    """The one answer every view shows: may this Change go on to approval?

    Pode seguir = weighted average >= threshold AND consistency score (one
    decimal) >= threshold AND no real contradiction listed AND the backout plan
    is not NAO_ADERENTE (below 50%). Suggestions live in guidance and never
    decide. A field the AI could not read holds the verdict back.
    """

    passes: bool
    reason_code: str = Field(
        description=(
            "passes | field_missing | average_below | semantic_missing | coherence_below | "
            "contradictions | backout_not_adherent"
        )
    )
    reason: str
    failed: list[str] = Field(
        default_factory=list,
        description="Every gate that held the Change back, in order; reason_code is the first.",
    )


class ScopeVerdict(BaseModel):
    """Whether the Change is evaluated at all. Absence is not a low score."""

    in_scope: bool
    reason: str = ""


class EvaluationResponse(BaseModel):
    """The full, transparent result of evaluating one Change."""

    number: str
    rubric_version: str
    scope: ScopeVerdict
    fields: list[FieldScore] = Field(default_factory=list)
    overall: float | None = None
    threshold: float
    semantic: SemanticAnalysis | None = None
    semantic_skipped_reason: str | None = None
    decision: Decision | None = Field(
        default=None, description="Null only when the Change is out of scope."
    )
    model: str
    model_calls: int = Field(description="How many model calls this request made.")
    duration_ms: int
