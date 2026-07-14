"""Preflight: live eligibility of the pinned routes, prices and drift evidence.

PROTOTYPE. Before any paid call, the comparison re-collects the two public,
key-less surfaces (catalog + ZDR endpoints), recomputes the eligibility
intersection per candidate — ZDR route, ``structured_outputs`` support, healthy
status — and verifies that every pinned endpoint tag is still inside it. Any
miss aborts the run before money moves. The sanitized projection (with its
collection instant) becomes part of the run's evidence bundle, so the execution
conditions are reproducible even after catalog drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

_MODELS_URL = "https://openrouter.ai/api/v1/models"
_ZDR_URL = "https://openrouter.ai/api/v1/endpoints/zdr"


@dataclass(frozen=True)
class EligibleRoute:
    """One ZDR endpoint that passed the eligibility intersection."""

    model_id: str
    provider_name: str
    tag: str
    quantization: str | None
    context_length: int | None
    prompt_per_token: float
    completion_per_token: float


@dataclass(frozen=True)
class PreflightResult:
    """Eligible routes per candidate plus the sanitized projection artifact."""

    routes: dict[str, list[EligibleRoute]]
    projection: dict[str, Any]


class PreflightError(RuntimeError):
    """A candidate or pinned route is no longer eligible — abort before spending."""


def _supports(endpoint: dict[str, Any], parameter: str) -> bool:
    return parameter in (endpoint.get("supported_parameters") or [])


async def collect(
    client: httpx.AsyncClient, model_ids: list[str], *, started: str
) -> PreflightResult:
    """Fetch catalog + ZDR endpoints and compute the eligibility intersection."""
    models_response = await client.get(_MODELS_URL)
    models_response.raise_for_status()
    zdr_response = await client.get(_ZDR_URL)
    zdr_response.raise_for_status()

    catalog = {
        entry["id"]: entry
        for entry in models_response.json()["data"]
        if entry.get("id") in model_ids
    }
    missing = [model_id for model_id in model_ids if model_id not in catalog]
    if missing:
        raise PreflightError(f"candidates absent from the live catalog: {missing}")

    routes: dict[str, list[EligibleRoute]] = {model_id: [] for model_id in model_ids}
    sanitized_endpoints: list[dict[str, Any]] = []
    for endpoint in zdr_response.json()["data"]:
        model_id = endpoint.get("model_id")
        if model_id not in routes:
            continue
        eligible = _supports(endpoint, "structured_outputs") and endpoint.get("status", -1) >= 0
        pricing = endpoint.get("pricing") or {}
        sanitized_endpoints.append(
            {
                "model_id": model_id,
                "provider_name": endpoint.get("provider_name"),
                "tag": endpoint.get("tag"),
                "quantization": endpoint.get("quantization"),
                "context_length": endpoint.get("context_length"),
                "pricing": {
                    "prompt": pricing.get("prompt"),
                    "completion": pricing.get("completion"),
                },
                "status": endpoint.get("status"),
                "eligible": eligible,
            }
        )
        if eligible:
            routes[model_id].append(
                EligibleRoute(
                    model_id=model_id,
                    provider_name=str(endpoint.get("provider_name")),
                    tag=str(endpoint.get("tag")),
                    quantization=endpoint.get("quantization"),
                    context_length=endpoint.get("context_length"),
                    prompt_per_token=float(pricing.get("prompt") or 0.0),
                    completion_per_token=float(pricing.get("completion") or 0.0),
                )
            )

    projection = {
        "schema_version": "selection-projection/v1",
        "collected": started,
        "sources": {"models": _MODELS_URL, "zdr": _ZDR_URL},
        "eligibility_rule": "zdr AND structured_outputs AND status >= 0",
        "models": {
            model_id: {
                "canonical_slug": catalog[model_id].get("canonical_slug"),
                "context_length": catalog[model_id].get("context_length"),
                "pricing": {
                    key: catalog[model_id].get("pricing", {}).get(key)
                    for key in (
                        "prompt",
                        "completion",
                        "internal_reasoning",
                        "input_cache_read",
                        "input_cache_write",
                    )
                },
                "expiration_date": catalog[model_id].get("expiration_date"),
            }
            for model_id in model_ids
        },
        "zdr_endpoints": sanitized_endpoints,
    }
    return PreflightResult(routes=routes, projection=projection)


def require_pinned(result: PreflightResult, model_id: str, endpoint_tag: str) -> EligibleRoute:
    """Return the pinned route if still eligible; abort loudly otherwise."""
    for route in result.routes.get(model_id, []):
        if route.tag == endpoint_tag:
            return route
    available = [route.tag for route in result.routes.get(model_id, [])]
    raise PreflightError(
        f"pinned route {endpoint_tag!r} for {model_id} is no longer eligible; "
        f"eligible now: {available}"
    )
