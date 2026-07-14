"""Versioned, estimate-only price table and token heuristics.

PROTOTYPE. Cost estimation for the harness is a *first-class* concern (#20 §8:
fitting the full suite under US$ 0.50 is an eligibility criterion). Reported
provider cost always takes precedence; this table is used only for worst-case
budget *reservation* before a call and as a fallback estimate — never as billing
truth. It carries a freshness stamp because prices are perishable.
"""

from __future__ import annotations

from dataclasses import dataclass

PRICE_TABLE_VERSION = "openrouter-estimate/2026-07"  # perishable — revalidate on drift


@dataclass(frozen=True)
class ModelPrice:
    """USD per 1M tokens, input and output (estimate)."""

    input_per_m: float
    output_per_m: float


# Illustrative estimates only — NOT billing data. Revalidate against OpenRouter.
PRICES: dict[str, ModelPrice] = {
    "deepseek/deepseek-v4-flash": ModelPrice(input_per_m=0.14, output_per_m=0.28),
    "google/gemini-2.5-flash": ModelPrice(input_per_m=0.30, output_per_m=2.50),
    "anthropic/claude-haiku-4.5": ModelPrice(input_per_m=1.00, output_per_m=5.00),
    "qwen/qwen3-max": ModelPrice(input_per_m=0.60, output_per_m=2.40),
}
_FALLBACK = ModelPrice(input_per_m=1.00, output_per_m=5.00)  # conservative worst-case


def estimate_tokens(text: str) -> int:
    """Rough token count (≈4 chars/token). Marked as an estimate everywhere."""
    return max(1, (len(text) + 3) // 4)


def estimate_cost_usd(model: str, *, input_tokens: int, output_tokens: int) -> float:
    """Estimate a call's cost from the versioned table (conservative fallback)."""
    price = PRICES.get(model, _FALLBACK)
    return (input_tokens / 1_000_000) * price.input_per_m + (
        output_tokens / 1_000_000
    ) * price.output_per_m


def worst_case_cost_usd(model: str, *, max_input_tokens: int, max_output_tokens: int) -> float:
    """Worst-case cost the runner reserves before a call (uses the max envelope)."""
    return estimate_cost_usd(model, input_tokens=max_input_tokens, output_tokens=max_output_tokens)
