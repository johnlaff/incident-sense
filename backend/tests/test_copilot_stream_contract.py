"""Contract tests for the copilot SSE protocol v1, driven by shared fixtures.

The fixtures under ``contracts/copilot-stream/`` are the single source of
truth for the protocol; both this suite and the frontend Vitest suite read
them without duplicating a single event payload. See
``contracts/copilot-stream/README.md`` for the full contract.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from incident_sense.models.copilot_stream import (
    ActionBlock,
    AnswerKind,
    CopilotAnswer,
    DiagnosisBlock,
    ExplanationBlock,
    Grounding,
    IncidentClassification,
    Locale,
    QuestionBlock,
    StreamContractError,
    parse_sse_stream,
)
from incident_sense.models.suggest import Classification

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "contracts" / "copilot-stream"


def _load_fixtures(subdir: str) -> list[tuple[str, dict[str, Any]]]:
    directory = FIXTURES_DIR / subdir
    return sorted(
        ((path.stem, json.loads(path.read_text())) for path in directory.glob("*.json")),
        key=lambda item: item[0],
    )


VALID_FIXTURES = _load_fixtures("valid")
INVALID_FIXTURES = _load_fixtures("invalid")


@pytest.mark.parametrize("name,fixture", VALID_FIXTURES, ids=[name for name, _ in VALID_FIXTURES])
def test_valid_stream_is_accepted(name: str, fixture: dict[str, Any]) -> None:
    events = parse_sse_stream(fixture["chunks"])

    assert len(events) == fixture["expect"]["event_count"]
    assert events[-1].type == fixture["expect"]["terminal_type"]


@pytest.mark.parametrize(
    "name,fixture", INVALID_FIXTURES, ids=[name for name, _ in INVALID_FIXTURES]
)
def test_invalid_stream_is_rejected(name: str, fixture: dict[str, Any]) -> None:
    with pytest.raises(StreamContractError) as exc_info:
        parse_sse_stream(fixture["chunks"])

    assert exc_info.value.code == fixture["expect"]["error_code"]


def test_diagnosis_block_without_citation_is_rejected() -> None:
    with pytest.raises(ValueError, match="citation"):
        CopilotAnswer(
            kind=AnswerKind.GROUNDED_ANSWER,
            locale=Locale.PT_BR,
            incident_classification=IncidentClassification(
                verdict=Classification.PROCEDENTE, justification="Sintoma real e recorrente."
            ),
            grounding=Grounding.CITED,
            blocks=[DiagnosisBlock(text="Sem citação.", citations=[])],
        )


def test_question_block_without_citation_is_accepted() -> None:
    answer = CopilotAnswer(
        kind=AnswerKind.GENERAL_EXPLANATION,
        locale=Locale.PT_BR,
        incident_classification=IncidentClassification(
            verdict=Classification.PROCEDENTE, justification="Escopo ambíguo."
        ),
        grounding=Grounding.NOT_REQUIRED,
        blocks=[QuestionBlock(text="Pode detalhar o sintoma?", citations=[])],
    )

    assert answer.blocks[0].text == "Pode detalhar o sintoma?"


def test_action_block_without_citation_is_rejected() -> None:
    with pytest.raises(ValueError, match="citation"):
        CopilotAnswer(
            kind=AnswerKind.GROUNDED_ANSWER,
            locale=Locale.PT_BR,
            incident_classification=IncidentClassification(
                verdict=Classification.PROCEDENTE, justification="Sintoma real e recorrente."
            ),
            grounding=Grounding.CITED,
            blocks=[
                ExplanationBlock(text="Contexto.", citations=[]),
                ActionBlock(text="Sem citação.", citations=[]),
            ],
        )
