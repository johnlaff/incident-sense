"""Unit tests for the provider helpers (pure, no network)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from incident_sense.providers import chat_text, extract_json, extract_json_objects
from incident_sense.rag.clients import OpenAILLMClient


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


class _FakeCompletions:
    def __init__(self) -> None:
        self.kwargs: dict[str, Any] = {}

    def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        message = SimpleNamespace(content='{"ok": true}')
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _fake_client() -> tuple[Any, _FakeCompletions]:
    completions = _FakeCompletions()
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


def test_chat_text_leaves_reasoning_to_the_provider_by_default() -> None:
    client, completions = _fake_client()
    chat_text(client, "m", [{"role": "user", "content": "oi"}])
    assert completions.kwargs["extra_body"] is None


def test_chat_text_can_turn_reasoning_off() -> None:
    # Reasoning models spend max_tokens on hidden reasoning first; a judge that
    # needs the JSON in the visible answer turns it off.
    client, completions = _fake_client()
    chat_text(client, "m", [{"role": "user", "content": "oi"}], reasoning=False)
    assert completions.kwargs["extra_body"] == {"reasoning": {"enabled": False}}


def test_llm_client_forwards_reasoning_setting() -> None:
    client, completions = _fake_client()
    OpenAILLMClient(client, "m", reasoning=False).complete("s", "u")
    assert completions.kwargs["extra_body"] == {"reasoning": {"enabled": False}}
