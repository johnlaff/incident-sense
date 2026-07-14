"""Sentinel run of one graduation candidate through the selection probe.

PROTOTYPE. Deliberately NOT a test and NOT importable by ``make test``: it spends
money (hard cap = the suite cap, US$ 0.50 — #20 §8) and requires
``OPENROUTER_API_KEY``. Run explicitly:

    cd backend && uv run python -m prototypes.eval_harness.selection.sentinel [--smoke]

Purpose: evaluate one optional-graduation candidate — default
``deepseek/deepseek-v4-pro`` on the pinned ZDR route ``parasail/fp8`` — under the
same conditions as the controlled comparison (``selection/compare.py`` / #23):
same probe contract, same frozen ``selection-bilingual`` corpus, same
route-pinning, budget admission and sanitization. The route is pinned to the one
``deepseek-v4-flash`` ran on in #23 (Parasail, fp8) so the run isolates the model
*tier* — Pro vs Flash — rather than confounding it with a provider or
quantization change.

The decision this run informs (graduation rule of #17, cascade of #24): the
candidate enters the supported-alternatives portfolio **iff** it clears the hard
invariants of the lexicographic selection cascade — schema-invalid, contract
violations, forged citations and isolation failures all zero, with every case
completed. That gate, and only that gate, is computed here as a pass/fail
verdict. The continuous reading (route-match, refusals, latency, cost) is
evidence for the human/PR decision, never a substitute for the gate. A candidate
of the DeepSeek family can never be the reference (it occupies the judge ladder
of #20); the scope here is exclusively supported alternative (non-gating).

Reservation uses the pinned route's live price, which for Pro on Parasail fp8 is
~4x the catalog aggregate (US$ 1.74 / 3.48 vs 0.435 / 0.87 per 1M) — worst-case
budgeting never bets on the cheaper aggregate. Reasoning is requested ``none``
(non-thinking, as the Flash run on this route); the output cap carries headroom
so that any reasoning tokens a reasoning-capable model leaks cannot truncate the
JSON into a spurious schema failure. Actual billing (reported cost) takes
precedence, so the headroom costs nothing when the model stays non-thinking.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

import httpx

from incident_sense.config import Settings

from ..judges import HeuristicGroundednessJudge
from ..runner import load_cases, load_manifest, run_suite
from ..writers import write_bundle
from . import preflight
from .compare import summarize_model
from .contexts import evidence_corpus
from .probe import PROBE_VERSION, ModelSpec, OpenRouterProbeTarget, worst_case_call_usd

_HERE = Path(__file__).parent
_MANIFEST = _HERE / "dataset" / "manifest.json"
_ARTIFACTS = _HERE.parent / "_artifacts" / "sentinel"
_CAP_USD = 0.50  # the suite cap (system + judges) — #20 §8
# Match the comparison's concurrency (#23) for apples-to-apples. The Parasail fp8
# route provider-throttles deepseek-v4-pro ("temporarily rate-limited", plus 524
# gateway timeouts) independently of this setting — serializing did not reduce
# the drops — so partial completion under throttling is a route-health finding,
# not a knob to tune; the transport-rerun policy (#20) absorbs the transient hits.
_CONCURRENCY = 3

# The single graduation candidate, pinned to the route deepseek-v4-flash ran on
# in #23 (Parasail, fp8) so the run isolates the model tier. Prices are the live
# Parasail fp8 ROUTE price (4x the catalog aggregate); reservations never bet on
# the cheaper aggregate. Reasoning "none": non-thinking, mirroring the Flash run.
CANDIDATE = ModelSpec(
    model_id="deepseek/deepseek-v4-pro",
    endpoint_tag="parasail/fp8",
    send_temperature=True,
    reasoning={"effort": "none"},
    reasoning_reserve_tokens=0,
    # Headroom above the Flash run's 1200: a reasoning-capable model that ignores
    # "none" would otherwise truncate into a spurious schema failure. Billed on
    # actual, so it costs nothing while the model stays non-thinking; the cap only
    # bounds the worst case the budget admission reserves against.
    max_output_tokens=2000,
    max_tokens_param="max_tokens",
    reserve_input_per_m=1.74,
    reserve_output_per_m=3.48,
)


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
        )
        return out.stdout.strip() or "unknown"
    except (subprocess.SubprocessError, OSError):
        return "unknown"


def _slug(model_id: str) -> str:
    return model_id.replace("/", "__")


def hard_invariants(summary: dict[str, object], *, total_cases: int) -> dict[str, int]:
    """The level-1 gate of the lexicographic cascade (#24), as integer counts.

    Every count must be zero to graduate: schema/protocol/structural-citation
    validity per case, forged citations, isolation and full completion. Request
    rejections and transport failures are folded in — a case that did not return
    a validated answer is not a clean case.
    """
    failures = summary["failures"]  # type: ignore[index]
    citations = summary["citations"]  # type: ignore[index]
    violations = summary["contract_violations"]  # type: ignore[index]
    completed = int(summary["completed"])  # type: ignore[arg-type]
    return {
        "schema_invalid": len(failures["schema_invalid"]),  # type: ignore[index]
        "request_rejected": len(failures["request_rejected"]),  # type: ignore[index]
        "transport": len(failures["transport"]),  # type: ignore[index]
        "contract_violations": sum(int(v) for v in violations.values()),  # type: ignore[union-attr]
        "forged_citations": int(citations["forged_total"]),  # type: ignore[index]
        "isolation_failures": int(citations["isolation_failures"]),  # type: ignore[index]
        "incomplete_cases": total_cases - completed,
    }


async def _run(*, smoke: bool) -> None:
    settings = Settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY ausente; o sentinel exige a chave.")

    manifest = load_manifest(_MANIFEST)
    cases = load_cases(_MANIFEST)
    if smoke:
        cases = cases[:1]

    spec = CANDIDATE
    started = datetime.now(UTC).isoformat()
    git_sha = _git_sha()
    model_dir = _ARTIFACTS / _slug(spec.model_id)
    model_dir.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        result = await preflight.collect(client, [spec.model_id], started=started)
        route = preflight.require_pinned(result, spec.model_id, spec.endpoint_tag)
        (_ARTIFACTS / "projection.json").write_text(
            json.dumps(result.projection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        # Never under-reserve: if the live route price drifted above the pinned
        # reservation, abort before any call rather than risk breaching the cap.
        route_in = route.prompt_per_token * 1_000_000
        route_out = route.completion_per_token * 1_000_000
        if route_in > spec.reserve_input_per_m or route_out > spec.reserve_output_per_m:
            raise SystemExit(
                f"rota {spec.endpoint_tag} encareceu além da reserva "
                f"(vivo {route_in:.4f}/{route_out:.4f} > reserva "
                f"{spec.reserve_input_per_m:.4f}/{spec.reserve_output_per_m:.4f} por M); "
                "reavaliar preços antes de gastar."
            )

        # Admission: the whole plan's worst case must fit the cap BEFORE any call.
        plan_reserve = sum(worst_case_call_usd(spec, case) for case in cases)
        print(
            f"plano: {spec.model_id} @ {route.provider_name}:{route.tag} "
            f"(quant {route.quantization}) × {len(cases)} casos"
        )
        print(
            f"preço da rota (vivo): US$ {route_in:.4f}/{route_out:.4f} por M "
            f"(reserva US$ {spec.reserve_input_per_m:.4f}/{spec.reserve_output_per_m:.4f})"
        )
        print(f"pior caso total: US$ {plan_reserve:.4f} (cap US$ {_CAP_USD:.2f})")
        if plan_reserve > _CAP_USD:
            raise SystemExit("plano excede o cap; reduzir casos antes de executar.")

        evidence = evidence_corpus()
        judges = [HeuristicGroundednessJudge()]
        target = OpenRouterProbeTarget(spec, api_key=settings.openrouter_api_key, client=client)
        run = await run_suite(
            cases,
            target,
            judges,
            evidence=evidence,
            dataset_version=manifest.dataset_version,
            started=datetime.now(UTC).isoformat(),
            concurrency=_CONCURRENCY,
            budget_cap_usd=_CAP_USD,
            model=spec.model_id,
            checkpoint_path=model_dir / "cases.checkpoint.jsonl",
            reserve_for_case=partial(worst_case_call_usd, spec),
        )

    write_bundle(run, model_dir, model=spec.model_id, git_sha=git_sha)
    # Full transcripts stay LOCAL (30-day telemetry policy, #19): the sanitized
    # bundle redacts answer text; this diagnostic file keeps it on host.
    (model_dir / "transcripts.local.jsonl").write_text(
        "\n".join(r.execution.model_dump_json() for r in run.results) + "\n", encoding="utf-8"
    )

    summary = summarize_model(run, cases)
    gate = hard_invariants(summary, total_cases=len(cases))
    graduates = all(count == 0 for count in gate.values())

    sentinel = {
        "schema_version": "selection-sentinel/v1",
        "probe_version": PROBE_VERSION,
        "started": started,
        "git_sha": git_sha,
        "dataset_version": manifest.dataset_version,
        "dataset_sha256": manifest.files[0].sha256,
        "candidate": spec.model_id,
        "reference_eligible": False,  # DeepSeek family occupies the judge ladder (#20)
        "budget": {
            "cap_usd": _CAP_USD,
            "plan_worst_case_usd": round(plan_reserve, 6),
            "spent_reported_usd": round(run.budget_spent_usd, 6),
        },
        "conditions": {
            "pinned_route": {
                "endpoint_tag": spec.endpoint_tag,
                "provider": route.provider_name,
                "quantization": route.quantization,
                "route_price_per_m": {
                    "prompt": round(route_in, 4),
                    "completion": round(route_out, 4),
                },
                "temperature_sent": spec.send_temperature,
                "reasoning": spec.reasoning,
                "max_output_tokens": spec.max_output_tokens,
            },
            "provider_prefs": {
                "allow_fallbacks": False,
                "require_parameters": True,
                "zdr": True,
                "data_collection": "deny",
            },
            "timeouts_s": {"connect": 10, "read": 60},
            "transport_reruns_max": 2,
            "retrieval": "held constant per case (same approved evidence)",
            "baseline_run": (
                "docs/evals/selecao-modelos-openrouter (#23), deepseek-v4-flash @ parasail/fp8"
            ),
        },
        "hard_invariants": gate,
        "graduation": {
            "rule": "graduate iff every hard invariant is zero (cascade level 1, #24)",
            "verdict": "graduate" if graduates else "exclude",
        },
        "summary": summary,
    }
    (_ARTIFACTS / "sentinel.json").write_text(
        json.dumps(sentinel, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    verdict = "GRADUA" if graduates else "EXCLUI"
    print(f"\ninvariantes duras: {json.dumps(gate, ensure_ascii=False)}")
    print(
        f"recusas falsas/perdidas: {summary['refusals']} · "  # type: ignore[index]
        f"rota-match geral: {summary['route_match']['overall']} · "  # type: ignore[index]
        f"latência p50/p95: {summary['latency_ms']['p50']}/{summary['latency_ms']['p95']} ms"  # type: ignore[index]
    )
    print(f"gasto reportado US$ {run.budget_spent_usd:.4f}")
    print(f">>> VEREDITO: {verdict} (invariantes duras {'zeradas' if graduates else 'furadas'})")
    print(f"artefatos em {_ARTIFACTS}/")


def main() -> None:
    """CLI: ``--smoke`` runs one cheap case before committing to the full corpus."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="1 caso, para validar a fiação")
    args = parser.parse_args()
    asyncio.run(_run(smoke=args.smoke))


if __name__ == "__main__":
    main()
