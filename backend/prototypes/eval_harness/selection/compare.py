"""Controlled comparison of the six OpenRouter candidates — the paid entrypoint.

PROTOTYPE. Deliberately NOT a test and NOT importable by ``make test``: it spends
money (hard cap US$ 1.50 for the whole selection) and requires
``OPENROUTER_API_KEY``. Run explicitly:

    cd backend && uv run python -m prototypes.eval_harness.selection.compare [--smoke]

Protocol (research on the shortlist + the eval contract):

1. **Preflight**: re-collect the public catalog/ZDR surfaces, verify every pinned
   route is still in the eligibility intersection, archive the sanitized
   projection. No key, no cost.
2. **Admission**: sum the worst-case reservation of every planned call (system
   under test only — the judges here are non-LLM and free). The run starts only
   if the whole plan fits the cap; there is no retroactive masking of overruns.
3. **Execution**: models run sequentially against the same frozen selection
   corpus, drawing from one shared budget; each case reserves its own worst case
   before the call. Reported cost takes precedence over estimates.
4. **Evidence**: one sanitized bundle per model plus a cross-model
   ``comparison.json``/``comparison.md``. No winner is computed — hypothesis
   ranking belongs to the human decision.

The comparison isolates the model variable: retrieval is held constant per case
(same approved evidence for every model), so retrieval metrics are not
comparative evidence in this run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import subprocess
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

import httpx

from incident_sense.config import Settings

from ..judges import HeuristicGroundednessJudge
from ..runner import load_cases, load_manifest, run_suite
from ..schema import EvalCase, EvalRun, GateStatus
from . import preflight
from .contexts import evidence_corpus
from .probe import PROBE_VERSION, ModelSpec, OpenRouterProbeTarget, worst_case_call_usd

_HERE = Path(__file__).parent
_MANIFEST = _HERE / "dataset" / "manifest.json"
_ARTIFACTS = _HERE.parent / "_artifacts" / "selection"
_CAP_USD = 1.50  # hard cap for the whole selection (system under test + judges)

# The pinned ZDR routes and capability-aware parameters per candidate.
# Reservation prices are USD per 1M tokens and take the WORST applicable input
# price (max of prompt / cache read / cache write on the pinned route) and, for
# Claude Sonnet 5, the announced post-promotional standard price — reservations
# never bet on a promotion. Reasoning is explicit: mandatory floor on Gemini 3.5
# Flash, "none" on DeepSeek (non-thinking), "minimal" where optional-but-on,
# omitted where the default is off (Sonnet 5, Mistral Small).
PORTFOLIO: list[ModelSpec] = [
    ModelSpec(
        model_id="openai/gpt-5.6-luna",
        endpoint_tag="azure",
        send_temperature=False,
        reasoning={"effort": "minimal"},
        reasoning_reserve_tokens=0,  # reasoning counts inside the completion budget
        max_output_tokens=2000,
        max_tokens_param="max_completion_tokens",  # the only cap the route supports
        reserve_input_per_m=1.25,
        reserve_output_per_m=6.0,
    ),
    ModelSpec(
        model_id="anthropic/claude-sonnet-5",
        # Azure route: the Bedrock routes advertise structured_outputs but reject
        # the mapped request in practice ("output_config.format" not permitted).
        endpoint_tag="azure/us-east-2",
        send_temperature=False,
        reasoning=None,
        reasoning_reserve_tokens=0,
        reserve_input_per_m=3.75,
        reserve_output_per_m=15.0,
    ),
    ModelSpec(
        model_id="google/gemini-3.5-flash",
        endpoint_tag="google-vertex/global",
        send_temperature=False,
        reasoning={"effort": "low"},
        reasoning_reserve_tokens=0,  # reasoning counts inside the completion budget
        max_output_tokens=3000,  # low effort spends ~1k reasoning tokens of this
        reserve_input_per_m=1.5,
        reserve_output_per_m=9.0,
    ),
    ModelSpec(
        model_id="google/gemini-3.1-flash-lite",
        endpoint_tag="google-vertex/global",
        send_temperature=False,
        reasoning={"effort": "minimal"},
        reasoning_reserve_tokens=500,
        reserve_input_per_m=0.25,
        reserve_output_per_m=1.5,
    ),
    ModelSpec(
        model_id="deepseek/deepseek-v4-flash",
        endpoint_tag="parasail/fp8",
        send_temperature=True,
        reasoning={"effort": "none"},
        reasoning_reserve_tokens=0,
        reserve_input_per_m=0.14,
        reserve_output_per_m=0.28,
    ),
    ModelSpec(
        model_id="mistralai/mistral-small-2603",
        endpoint_tag="venice/fp8",
        send_temperature=True,
        reasoning=None,
        reasoning_reserve_tokens=0,
        reserve_input_per_m=0.1875,
        reserve_output_per_m=0.75,
    ),
]


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


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return round(ordered[index], 1)


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def summarize_model(run: EvalRun, cases: list[EvalCase]) -> dict[str, object]:
    """Cross-model comparable aggregates for one model's suite run."""
    by_id = {case.case_id: case for case in cases}
    results = run.results
    ok = [r for r in results if r.execution.error is None]
    schema_invalid = [r for r in results if (r.execution.error or "").startswith("schema-invalid")]
    rejected = [r for r in results if (r.execution.error or "").startswith("request-rejected")]
    transport = [
        r
        for r in results
        if r.execution.error is not None
        and not (r.execution.error or "").startswith(("schema-invalid", "request-rejected"))
    ]

    def route_hits(locale: str | None = None) -> tuple[int, int]:
        eligible = [r for r in ok if locale is None or r.locale == locale]
        hits = sum(1 for r in eligible if r.gates.get("route-match") == GateStatus.PASS)
        return hits, len(eligible)

    route_all = route_hits()
    route_pt = route_hits("pt-BR")
    route_en = route_hits("en")

    false_refusals = 0
    missed_refusals = 0
    for r in ok:
        expected = by_id[r.case_id].expected.refusal.value
        refused = bool(r.execution.answer and r.execution.answer.refused)
        if expected == "must-not-refuse" and refused:
            false_refusals += 1
        if expected == "must-refuse" and not refused:
            missed_refusals += 1

    forged_total = 0
    isolation_failures = 0
    violation_counts: dict[str, int] = {}
    for r in ok:
        for metric in r.metrics:
            if metric.name == "forged-citations" and metric.value:
                forged_total += int(metric.value)
        if r.gates.get("isolation") == GateStatus.FAIL:
            isolation_failures += 1
        if r.execution.answer:
            for violation in r.execution.answer.contract_violations:
                key = violation.split(":", 1)[0]
                violation_counts[key] = violation_counts.get(key, 0) + 1

    groundedness = [
        j.score
        for r in ok
        for j in r.judge_results
        if j.metric == "groundedness" and j.score is not None
    ]
    latencies = [
        r.execution.stage_latency_ms["turn_ms"]
        for r in ok
        if "turn_ms" in r.execution.stage_latency_ms
    ]
    tokens_in = sum(t.input_tokens or 0 for r in results for t in r.execution.telemetry)
    tokens_out = sum(t.output_tokens or 0 for r in results for t in r.execution.telemetry)
    tokens_reasoning = sum(t.reasoning_tokens or 0 for r in results for t in r.execution.telemetry)
    tokens_cached = sum(t.cached_tokens or 0 for r in results for t in r.execution.telemetry)
    cost_reported = sum(
        t.cost_usd or 0.0
        for r in results
        for t in r.execution.telemetry
        if t.cost_source == "reported"
    )
    attempts_extra = sum(
        1 for r in results for t in r.execution.telemetry if t.purpose.startswith("turn-attempt")
    )
    providers = sorted(
        {
            f"{t.provider}:{t.endpoint_tag}"
            for r in results
            for t in r.execution.telemetry
            if t.provider is not None
        }
    )
    routes_pt = route_pt[0] / route_pt[1] if route_pt[1] else None
    routes_en = route_en[0] / route_en[1] if route_en[1] else None
    return {
        "cases": len(results),
        "completed": len(ok),
        "failures": {
            "schema_invalid": [r.case_id for r in schema_invalid],
            "request_rejected": [r.case_id for r in rejected],
            "transport": [r.case_id for r in transport],
            "retried_attempts": attempts_extra,
        },
        "route_match": {
            "overall": _rate(*route_all),
            "pt-BR": _rate(*route_pt),
            "en": _rate(*route_en),
            "pt_en_delta": (
                round(abs(routes_pt - routes_en), 4)
                if routes_pt is not None and routes_en is not None
                else None
            ),
        },
        "refusals": {"false": false_refusals, "missed": missed_refusals},
        "citations": {"forged_total": forged_total, "isolation_failures": isolation_failures},
        "contract_violations": violation_counts,
        "groundedness_heuristic_mean": (
            round(statistics.mean(groundedness), 4) if groundedness else None
        ),
        "latency_ms": {
            "p50": _percentile(latencies, 0.50),
            "p95": _percentile(latencies, 0.95),
            "max": _percentile(latencies, 1.0),
        },
        "tokens": {
            "input": tokens_in,
            "output": tokens_out,
            "reasoning": tokens_reasoning,
            "cached": tokens_cached,
        },
        "cost_reported_usd": round(cost_reported, 6),
        "providers_observed": providers,
        "verdict": run.verdict.value,
    }


def _comparison_md(
    summaries: dict[str, dict[str, object]],
    *,
    started: str,
    git_sha: str,
    dataset_version: str,
    spent: float,
    reserved_plan: float,
) -> str:
    def cell(summary: dict[str, object], *keys: str) -> object:
        value: object = summary
        for key in keys:
            value = value[key] if isinstance(value, dict) and key in value else "—"
        return value if value is not None else "—"

    header = "| métrica | " + " | ".join(f"`{m}`" for m in summaries) + " |"
    sep = "| --- |" + " --- |" * len(summaries)
    rows = [
        ("casos completados", ("completed",)),
        ("schema inválido", ("failures", "schema_invalid")),
        ("request rejeitado", ("failures", "request_rejected")),
        ("falha de transporte", ("failures", "transport")),
        ("tentativas repetidas", ("failures", "retried_attempts")),
        ("rota correta (geral)", ("route_match", "overall")),
        ("rota correta (pt-BR)", ("route_match", "pt-BR")),
        ("rota correta (en)", ("route_match", "en")),
        ("delta PT↔EN (rota)", ("route_match", "pt_en_delta")),
        ("recusas falsas", ("refusals", "false")),
        ("recusas perdidas", ("refusals", "missed")),
        ("citações forjadas", ("citations", "forged_total")),
        ("falhas de isolamento", ("citations", "isolation_failures")),
        ("violações de contrato", ("contract_violations",)),
        ("groundedness heurístico (informativo)", ("groundedness_heuristic_mean",)),
        ("latência p50 (ms)", ("latency_ms", "p50")),
        ("latência p95 (ms)", ("latency_ms", "p95")),
        ("tokens de saída", ("tokens", "output")),
        ("tokens de raciocínio", ("tokens", "reasoning")),
        ("custo reportado (US$)", ("cost_reported_usd",)),
        ("rotas efetivas", ("providers_observed",)),
    ]
    lines = [
        "# Comparação controlada dos modelos candidatos",
        "",
        f"- Início: `{started}` · SHA: `{git_sha}` · dataset: `{dataset_version}` · "
        f"probe: `{PROBE_VERSION}`",
        f"- Orçamento: plano de pior caso US$ {reserved_plan:.4f} · gasto reportado "
        f"US$ {spent:.4f} · cap US$ {_CAP_USD:.2f}",
        "- Nenhum vencedor é computado; a leitura pertence à decisão humana.",
        "",
        header,
        sep,
    ]
    for label, keys in rows:
        cells = " | ".join(
            json.dumps(cell(s, *keys), ensure_ascii=False) for s in summaries.values()
        )
        lines.append(f"| {label} | {cells} |")
    lines.append("")
    return "\n".join(lines)


async def _run(*, smoke: bool) -> None:
    settings = Settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY ausente; a comparação exige a chave.")

    manifest = load_manifest(_MANIFEST)
    cases = load_cases(_MANIFEST)
    portfolio = PORTFOLIO
    if smoke:
        cases = cases[:1]
        portfolio = [spec for spec in PORTFOLIO if spec.model_id == "deepseek/deepseek-v4-flash"]

    started = datetime.now(UTC).isoformat()
    git_sha = _git_sha()
    _ARTIFACTS.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        result = await preflight.collect(
            client, [spec.model_id for spec in portfolio], started=started
        )
        pinned = {
            spec.model_id: preflight.require_pinned(result, spec.model_id, spec.endpoint_tag)
            for spec in portfolio
        }
        (_ARTIFACTS / "projection.json").write_text(
            json.dumps(result.projection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        # Admission: the whole plan's worst case must fit the cap BEFORE any call.
        plan_reserve = sum(worst_case_call_usd(spec, case) for spec in portfolio for case in cases)
        print(f"plano: {len(portfolio)} modelos × {len(cases)} casos")
        for spec in portfolio:
            route = pinned[spec.model_id]
            model_reserve = sum(worst_case_call_usd(spec, case) for case in cases)
            print(
                f"  {spec.model_id} @ {route.provider_name}:{route.tag} "
                f"(quant {route.quantization}) — pior caso US$ {model_reserve:.4f}"
            )
        print(f"pior caso total: US$ {plan_reserve:.4f} (cap US$ {_CAP_USD:.2f})")
        if plan_reserve > _CAP_USD:
            raise SystemExit("plano excede o cap; reduzir casos simetricamente antes de executar.")

        evidence = evidence_corpus()
        judges = [HeuristicGroundednessJudge()]
        summaries: dict[str, dict[str, object]] = {}
        spent_total = 0.0
        for spec in portfolio:
            remaining = _CAP_USD - spent_total
            model_dir = _ARTIFACTS / _slug(spec.model_id)
            model_dir.mkdir(parents=True, exist_ok=True)
            target = OpenRouterProbeTarget(spec, api_key=settings.openrouter_api_key, client=client)
            print(f"\n>>> {spec.model_id} (orçamento restante US$ {remaining:.4f})")
            run = await run_suite(
                cases,
                target,
                judges,
                evidence=evidence,
                dataset_version=manifest.dataset_version,
                started=datetime.now(UTC).isoformat(),
                concurrency=3,
                budget_cap_usd=remaining,
                model=spec.model_id,
                checkpoint_path=model_dir / "cases.checkpoint.jsonl",
                reserve_for_case=partial(worst_case_call_usd, spec),
            )
            from ..writers import write_bundle

            write_bundle(run, model_dir, model=spec.model_id, git_sha=git_sha)
            # Full transcripts stay LOCAL (30-day telemetry policy): the sanitized
            # bundle redacts answer text; this diagnostic file keeps it on host.
            diagnostics = model_dir / "transcripts.local.jsonl"
            diagnostics.write_text(
                "\n".join(r.execution.model_dump_json() for r in run.results) + "\n",
                encoding="utf-8",
            )
            spent_total += run.budget_spent_usd
            summaries[spec.model_id] = summarize_model(run, cases)
            print(
                f"    gasto reportado US$ {run.budget_spent_usd:.4f} · "
                f"acumulado US$ {spent_total:.4f}"
            )

    comparison = {
        "schema_version": "selection-comparison/v1",
        "probe_version": PROBE_VERSION,
        "started": started,
        "git_sha": git_sha,
        "dataset_version": manifest.dataset_version,
        "dataset_sha256": manifest.files[0].sha256,
        "budget": {
            "cap_usd": _CAP_USD,
            "plan_worst_case_usd": round(plan_reserve, 6),
            "spent_reported_usd": round(spent_total, 6),
        },
        "conditions": {
            "pinned_routes": {
                spec.model_id: {
                    "endpoint_tag": spec.endpoint_tag,
                    "provider": pinned[spec.model_id].provider_name,
                    "quantization": pinned[spec.model_id].quantization,
                    "temperature_sent": spec.send_temperature,
                    "reasoning": spec.reasoning,
                    "max_output_tokens": spec.max_output_tokens,
                }
                for spec in portfolio
            },
            "provider_prefs": {
                "allow_fallbacks": False,
                "require_parameters": True,
                "zdr": True,
                "data_collection": "deny",
            },
            "timeouts_s": {"connect": 10, "read": 60},
            "transport_reruns_max": 2,
            "retrieval": "held constant per case (same approved evidence for all models)",
        },
        "models": summaries,
    }
    (_ARTIFACTS / "comparison.json").write_text(
        json.dumps(comparison, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    markdown = _comparison_md(
        summaries,
        started=started,
        git_sha=git_sha,
        dataset_version=manifest.dataset_version,
        spent=spent_total,
        reserved_plan=plan_reserve,
    )
    (_ARTIFACTS / "comparison.md").write_text(markdown, encoding="utf-8")
    print("\n" + markdown)
    print(f"artefatos em {_ARTIFACTS}/")


def main() -> None:
    """CLI: ``--smoke`` runs one cheap case on the incumbent before the full plan."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="1 caso × modelo incumbente")
    args = parser.parse_args()
    asyncio.run(_run(smoke=args.smoke))


if __name__ == "__main__":
    main()
