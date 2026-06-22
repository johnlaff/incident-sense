"""Unit tests for the provider helpers (pure, no network)."""

from __future__ import annotations

import pytest

from incident_sense.providers import extract_json, extract_json_objects


def test_extract_json_plain_object() -> None:
    assert extract_json('{"a": 1, "b": [2, 3]}') == {"a": 1, "b": [2, 3]}


def test_extract_json_with_code_fence_and_prose() -> None:
    raw = 'Claro!\n```json\n{"ok": true}\n```\nEspero ter ajudado.'
    assert extract_json(raw) == {"ok": True}


def test_extract_json_array() -> None:
    assert extract_json("prefixo [1, 2, 3] sufixo") == [1, 2, 3]


def test_extract_json_raises_when_absent() -> None:
    with pytest.raises(ValueError, match="No JSON"):
        extract_json("sem json aqui")


def test_extract_json_objects_salvages_truncated_array() -> None:
    # The array is cut off mid-second-object; only the first is complete.
    truncated = '[{"n": "a", "x": 1}, {"n": "b", "x'
    salvaged = extract_json_objects(truncated)
    assert salvaged == [{"n": "a", "x": 1}]


def test_extract_json_objects_ignores_braces_in_strings() -> None:
    text = '[{"text": "tem { e } dentro", "ok": true}]'
    assert extract_json_objects(text) == [{"text": "tem { e } dentro", "ok": True}]
