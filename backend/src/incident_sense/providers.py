"""Low-level access to the LLM and embedding providers.

Two OpenAI-compatible clients:

* **Embeddings** always go to OpenAI (``text-embedding-3-large``).
* **Chat/reasoning** goes to an OpenAI-compatible endpoint that defaults to
  OpenRouter. Because both speak the same wire protocol, the same ``OpenAI``
  client class drives both — only the ``base_url`` and key differ.

These are thin functions so scripts (dataset generation, precompute) and the
RAG pipeline share one code path. The RAG layer wraps them behind protocols for
mocking; here we keep them concrete and simple.
"""

from __future__ import annotations

import contextlib
import json
from typing import Any, cast

from openai import OpenAI

from incident_sense.config import Settings

# Sent to OpenRouter for optional request attribution (recommended by their
# docs; harmless elsewhere).
_OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://github.com/johnlaff/incident-sense",
    "X-Title": "incident-sense",
}


def make_embedding_client(settings: Settings) -> OpenAI:
    """OpenAI client for embeddings (default base_url is OpenAI's)."""
    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Embeddings require an OpenAI key; "
            "copy .env.example to .env and fill it in."
        )
    return OpenAI(api_key=settings.openai_api_key)


def make_chat_client(settings: Settings) -> OpenAI:
    """OpenAI-compatible client for chat/reasoning (defaults to OpenRouter)."""
    if not settings.openrouter_api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. The chat LLM requires a key; "
            "copy .env.example to .env and fill it in."
        )
    return OpenAI(
        api_key=settings.openrouter_api_key,
        base_url=settings.llm_base_url,
        default_headers=_OPENROUTER_HEADERS,
    )


def embed_texts(client: OpenAI, model: str, texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts, preserving input order.

    Callers are responsible for chunking very large inputs.
    """
    response = client.embeddings.create(model=model, input=texts)
    # The API returns items with an ``index``; sort to be safe before stripping.
    items = sorted(response.data, key=lambda item: item.index)
    return [item.embedding for item in items]


def chat_text(
    client: OpenAI,
    model: str,
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Run a chat completion and return the assistant text.

    We deliberately do not use the ``response_format`` JSON mode: the chat model
    is reached through OpenRouter, and not every upstream provider supports it
    (some silently return empty content). For structured output we instead
    instruct JSON in the prompt and parse it with :func:`extract_json`, which is
    portable across providers.
    """
    # The SDK ships precise TypedDicts for messages; our plain dicts are
    # wire-compatible, so we cast to Any rather than re-typing them.
    completion = client.chat.completions.create(
        model=model,
        messages=cast(Any, messages),
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content or ""


def extract_json(text: str) -> Any:
    """Extract the first JSON object or array from possibly-noisy model output.

    Handles bare JSON, JSON wrapped in ```json fences, and JSON surrounded by
    prose. Raises ``ValueError`` if nothing parseable is found.
    """
    stripped = text.strip()
    # Fast path: the whole string is valid JSON.
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # Otherwise scan for the first balanced { } or [ ] block, ignoring brackets
    # that appear inside strings.
    start = _first_index(stripped, "{[")
    if start is None:
        raise ValueError("No JSON object or array found in model output.")

    opening = stripped[start]
    closing = "}" if opening == "{" else "]"
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(stripped)):
        char = stripped[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return json.loads(stripped[start : index + 1])
    raise ValueError("Unbalanced JSON in model output.")


def _first_index(text: str, chars: str) -> int | None:
    """Return the index of the earliest of ``chars`` in ``text``, or None."""
    positions = [text.index(c) for c in chars if c in text]
    return min(positions) if positions else None


def extract_json_objects(text: str) -> list[Any]:
    """Recover every complete top-level JSON object from text.

    Unlike :func:`extract_json`, this tolerates a truncated surrounding array:
    if the model's output was cut off mid-array, the complete objects before the
    cut are still returned. Used to salvage batched generation.
    """
    objects: list[Any] = []
    depth = 0
    in_string = False
    escaped = False
    start: int | None = None
    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                with contextlib.suppress(json.JSONDecodeError):
                    objects.append(json.loads(text[start : index + 1]))
                start = None
    return objects
