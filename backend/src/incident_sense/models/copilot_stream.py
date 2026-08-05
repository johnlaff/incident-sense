"""Pydantic models and parser for the copilot SSE protocol v1.

The wire contract (envelope, six event types, ``CopilotAnswer`` shape, and
error codes) lives in ``contracts/copilot-stream/README.md`` and is exercised
by fixtures under that directory — this module implements exactly what that
document specifies, nothing more. Keep the two in sync: a protocol change
starts in the README and its fixtures, then lands here.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from .suggest import Classification

# --- shared enums -----------------------------------------------------------


class Locale(StrEnum):
    """UI locale the turn was requested in."""

    PT_BR = "pt-BR"
    EN = "en"


class Phase(StrEnum):
    """One of the six pipeline phases a turn progresses through, in order."""

    POLICY = "policy"
    CLASSIFY = "classify"
    REWRITE = "rewrite"
    RETRIEVE = "retrieve"
    ANSWER = "answer"
    VALIDATE = "validate"


class PhaseStatus(StrEnum):
    """Whether a phase is starting or has just finished."""

    STARTED = "started"
    COMPLETED = "completed"


class Grounding(StrEnum):
    """How the answer relates to retrieved historical evidence."""

    CITED = "cited"
    NO_HISTORICAL_EVIDENCE = "no_historical_evidence"
    NOT_REQUIRED = "not_required"


class AnswerKind(StrEnum):
    """The high-level shape of the answer, independent of grounding."""

    GENERAL_EXPLANATION = "general_explanation"
    GROUNDED_ANSWER = "grounded_answer"
    NO_EVIDENCE = "no_evidence"
    REFUSAL = "refusal"


class StreamErrorCode(StrEnum):
    """Reasons ``parse_sse_stream`` can reject a stream.

    Mirrors ``error_code`` in ``contracts/copilot-stream/README.md`` exactly —
    every value here must have a corresponding fixture under ``invalid/``.
    """

    UNKNOWN_PROTOCOL_VERSION = "unknown_protocol_version"
    UNKNOWN_EVENT_TYPE = "unknown_event_type"
    INVALID_EVENT = "invalid_event"
    OUT_OF_ORDER_SEQUENCE = "out_of_order_sequence"
    DUPLICATE_SEQUENCE = "duplicate_sequence"
    MISSING_TERMINAL = "missing_terminal"
    EVENT_AFTER_TERMINAL = "event_after_terminal"


class StreamContractError(Exception):
    """Raised when a stream violates the protocol contract.

    ``code`` is one of ``StreamErrorCode`` and is what tests and callers key
    off of — the message is for humans reading logs, not for branching logic.
    """

    def __init__(self, code: StreamErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


# --- CopilotAnswer -----------------------------------------------------------


class IncidentClassification(BaseModel):
    """Verdict on whether the underlying ticket is a genuine incident."""

    verdict: Classification
    justification: str


class _CitedBlock(BaseModel):
    """Base shape shared by every answer block: prose plus its citations."""

    text: str
    citations: list[str] = Field(
        default_factory=list, description="Incident numbers grounding this block, if any."
    )


class ExplanationBlock(_CitedBlock):
    """Non-operational context; citations optional."""

    type: Literal["explanation"] = "explanation"


class DiagnosisBlock(_CitedBlock):
    """Operational: names a root cause. Requires at least one citation."""

    type: Literal["diagnosis"] = "diagnosis"


class ActionBlock(_CitedBlock):
    """Operational: recommends a next step. Requires at least one citation."""

    type: Literal["action"] = "action"


class CaveatBlock(_CitedBlock):
    """Non-operational caveat or warning; citations optional."""

    type: Literal["caveat"] = "caveat"


class QuestionBlock(_CitedBlock):
    """Non-operational clarification request; citations optional."""

    type: Literal["question"] = "question"


AnswerBlock = Annotated[
    ExplanationBlock | DiagnosisBlock | ActionBlock | CaveatBlock | QuestionBlock,
    Field(discriminator="type"),
]

# Block types that make an operational claim and therefore must point at the
# evidence backing it up.
_OPERATIONAL_BLOCK_TYPES = frozenset({"diagnosis", "action"})


class CopilotAnswer(BaseModel):
    """The final answer payload carried by ``answer.completed``.

    Three orthogonal dimensions describe it (``kind``, ``incident_classification``,
    ``grounding``) plus the ordered ``blocks`` that make up the prose.
    """

    kind: AnswerKind
    locale: Locale
    incident_classification: IncidentClassification
    grounding: Grounding
    blocks: list[AnswerBlock]

    @model_validator(mode="after")
    def _operational_blocks_require_citation(self) -> CopilotAnswer:
        for block in self.blocks:
            if block.type in _OPERATIONAL_BLOCK_TYPES and not block.citations:
                raise ValueError(f"'{block.type}' blocks require at least one citation, got none")
        return self


# --- envelope ----------------------------------------------------------------


class _EventEnvelope(BaseModel):
    """Fields common to every event on the wire."""

    protocol_version: Literal["1"]
    turn_id: UUID
    sequence: int = Field(ge=1)


class TurnAccepted(_EventEnvelope):
    """First event of every turn: the request was accepted for processing."""

    type: Literal["turn.accepted"] = "turn.accepted"
    incident_number: str
    locale: Locale
    model_requested: str


class PhaseChanged(_EventEnvelope):
    """A pipeline phase started or completed. ``duration_ms`` only on completion."""

    type: Literal["phase.changed"] = "phase.changed"
    phase: Phase
    status: PhaseStatus
    duration_ms: int | None = None

    @model_validator(mode="after")
    def _duration_only_on_completed(self) -> PhaseChanged:
        if self.status is PhaseStatus.COMPLETED and self.duration_ms is None:
            raise ValueError("'duration_ms' is required when status is 'completed'")
        if self.status is PhaseStatus.STARTED and self.duration_ms is not None:
            raise ValueError("'duration_ms' must be null when status is 'started'")
        return self


class RetrievalCandidate(BaseModel):
    """A past incident surfaced by retrieval, with post-filter transparency."""

    number: str
    short_description: str
    similarity: float = Field(description="Cosine similarity in [-1, 1].")
    survived_postfilter: bool
    postfilter_reason: str | None = None


class RetrievalCompleted(_EventEnvelope):
    """Retrieval finished; carries the query used and every candidate scored."""

    type: Literal["retrieval.completed"] = "retrieval.completed"
    query: str
    candidates: list[RetrievalCandidate]


class TelemetryEntry(BaseModel):
    """Per-LLM-call telemetry. Fields absent from the provider stay null."""

    call: str
    model: str | None = None
    provider: str | None = None
    generation_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None


class AnswerCompleted(_EventEnvelope):
    """Terminal: the answer is ready."""

    type: Literal["answer.completed"] = "answer.completed"
    answer: CopilotAnswer
    sources: list[str]
    telemetry: list[TelemetryEntry]


class TurnFailed(_EventEnvelope):
    """Terminal: the turn failed. ``retry_after_ms`` only meaningful when retryable."""

    type: Literal["turn.failed"] = "turn.failed"
    code: str
    message: str
    retryable: bool
    retry_after_ms: int | None = None


class TurnCancelled(_EventEnvelope):
    """Terminal: the turn was cancelled before completion."""

    type: Literal["turn.cancelled"] = "turn.cancelled"
    reason: str


StreamEvent = Annotated[
    TurnAccepted | PhaseChanged | RetrievalCompleted | AnswerCompleted | TurnFailed | TurnCancelled,
    Field(discriminator="type"),
]

STREAM_EVENT_ADAPTER: TypeAdapter[StreamEvent] = TypeAdapter(StreamEvent)

_KNOWN_EVENT_TYPES = frozenset(
    {
        "turn.accepted",
        "phase.changed",
        "retrieval.completed",
        "answer.completed",
        "turn.failed",
        "turn.cancelled",
    }
)

_TERMINAL_EVENT_TYPES = frozenset({"answer.completed", "turn.failed", "turn.cancelled"})


def _extract_payload(raw_event: str) -> str:
    """Join every ``data:`` line of one SSE event block into its JSON payload."""
    lines = [
        line[len("data:") :].lstrip() for line in raw_event.splitlines() if line.startswith("data:")
    ]
    return "\n".join(lines)


def parse_sse_stream(chunks: Iterable[str]) -> list[StreamEvent]:
    """Reassemble SSE chunks into validated, ordered protocol v1 events.

    Chunks are concatenated before splitting, so an event straddling a chunk
    boundary is handled transparently. Only ``data:`` lines carry payload;
    ``event:`` and ``id:`` are wire diagnostics and are ignored. Validation
    order matches ``contracts/copilot-stream/README.md`` exactly: malformed
    JSON, then protocol version, then event type, then schema/invariants,
    then sequencing, then terminal placement, then EOF-without-terminal.
    """
    full_text = "".join(chunks)
    raw_events = [block for block in full_text.split("\n\n") if block.strip()]

    events: list[StreamEvent] = []
    stream_turn_id: UUID | None = None
    previous_sequence: int | None = None
    terminal_seen = False

    for raw_event in raw_events:
        if terminal_seen:
            raise StreamContractError(
                StreamErrorCode.EVENT_AFTER_TERMINAL, "event received after the terminal event"
            )

        payload_text = _extract_payload(raw_event)
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError as exc:
            raise StreamContractError(
                StreamErrorCode.INVALID_EVENT, f"malformed JSON payload: {exc}"
            ) from exc

        if not isinstance(payload, dict):
            raise StreamContractError(
                StreamErrorCode.INVALID_EVENT, "event payload must be a JSON object"
            )

        protocol_version = payload.get("protocol_version")
        if protocol_version != "1":
            raise StreamContractError(
                StreamErrorCode.UNKNOWN_PROTOCOL_VERSION,
                f"unsupported protocol_version: {protocol_version!r}",
            )

        event_type = payload.get("type")
        if event_type not in _KNOWN_EVENT_TYPES:
            raise StreamContractError(
                StreamErrorCode.UNKNOWN_EVENT_TYPE, f"unknown event type: {event_type!r}"
            )

        try:
            event = STREAM_EVENT_ADAPTER.validate_python(payload)
        except Exception as exc:  # pydantic.ValidationError, or our model_validators
            raise StreamContractError(
                StreamErrorCode.INVALID_EVENT, f"event failed schema validation: {exc}"
            ) from exc

        if stream_turn_id is None:
            stream_turn_id = event.turn_id
        elif event.turn_id != stream_turn_id:
            raise StreamContractError(
                StreamErrorCode.INVALID_EVENT,
                f"turn_id changed mid-stream: {event.turn_id} != {stream_turn_id}",
            )

        if previous_sequence is None:
            if event.sequence != 1:
                raise StreamContractError(
                    StreamErrorCode.OUT_OF_ORDER_SEQUENCE, "first event sequence must be 1"
                )
        elif event.sequence == previous_sequence:
            raise StreamContractError(
                StreamErrorCode.DUPLICATE_SEQUENCE, f"duplicate sequence: {event.sequence}"
            )
        elif event.sequence < previous_sequence:
            raise StreamContractError(
                StreamErrorCode.OUT_OF_ORDER_SEQUENCE,
                f"sequence {event.sequence} arrived after {previous_sequence}",
            )

        previous_sequence = event.sequence
        events.append(event)
        if event_type in _TERMINAL_EVENT_TYPES:
            terminal_seen = True

    if not terminal_seen:
        raise StreamContractError(
            StreamErrorCode.MISSING_TERMINAL, "stream ended without a terminal event"
        )

    return events
