"""Artifact writers: the release bundle, sanitized by default.

PROTOTYPE. Emits a reduced version of the canonical bundle (#20 §10):
``manifest.json``, ``cases.jsonl``, ``summary.json``, ``summary.md``,
``junit.xml`` and ``checksums.sha256``. Full answer text is redacted from the
public ``cases.jsonl`` (research §artifacts: full content off by default).

Two canonical artifacts are deliberately omitted here, not overlooked:

* ``events.jsonl`` (sanitized SSE spans) — the SSE endpoint (#18) does not exist
  yet, so there are no events to emit.
* ``calibration.json`` (judge gold agreement) — the prototype's judges are a stub
  and an uncalibrated heuristic; there is no calibration to report. It is written
  in production once the LLM judge ladder is calibrated (#20 §4-5).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape

from .pricing import PRICE_TABLE_VERSION
from .schema import CaseResult, EvalRun, GateStatus


def _sanitize_case(result: CaseResult) -> dict[str, object]:
    """Public per-case record: everything but the full answer text."""
    data = result.model_dump(mode="json")
    answer = data.get("execution", {}).get("answer")
    if isinstance(answer, dict):
        answer.pop("answer_text", None)  # redact full content from the public bundle
    return data


def write_run_manifest(run: EvalRun, path: Path, *, model: str, git_sha: str) -> None:
    """Write the run manifest: versions, model, budget and provenance."""
    manifest = {
        "schema_version": "eval-run-manifest/v1",
        "harness_version": run.harness_version,
        "dataset_version": run.dataset_version,
        "started": run.started,
        "target": run.target,
        "model": model,
        "price_table_version": PRICE_TABLE_VERSION,
        "git_sha": git_sha,
        "budget": {
            "cap_usd": run.budget_cap_usd,
            "spent_usd": run.budget_spent_usd,
            "per_case_reserved_usd": run.budget_reserved_usd,
            "aborted_on_budget": run.aborted_on_budget,
        },
        "verdict": run.verdict.value,
        "aggregates": run.aggregates,
    }
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_cases_jsonl(run: EvalRun, path: Path) -> None:
    """Write one sanitized record per case."""
    lines = [json.dumps(_sanitize_case(r), ensure_ascii=False) for r in run.results]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def write_summary_json(run: EvalRun, path: Path) -> None:
    """Machine-readable aggregates, verdict and per-gate failure lists."""
    summary = {
        "verdict": run.verdict.value,
        "aggregates": run.aggregates,
        "gate_failures": run.gate_failures(),
        "budget": {
            "cap_usd": run.budget_cap_usd,
            "spent_usd": run.budget_spent_usd,
            "aborted_on_budget": run.aborted_on_budget,
        },
    }
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _gate_counts(run: EvalRun) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for result in run.results:
        for name, status in result.gates.items():
            bucket = counts.setdefault(name, {"pass": 0, "fail": 0, "not-run": 0})
            bucket[status.value] += 1
    return counts


def write_summary_md(run: EvalRun, path: Path, *, model: str, git_sha: str) -> None:
    """Human summary that answers the five release questions at a glance."""
    verdict_icon = {"pass": "✅", "fail": "❌", "not-run": "⚪"}[run.verdict.value]
    lines = [
        f"# Eval run — {verdict_icon} {run.verdict.value.upper()}",
        "",
        f"- **SHA**: `{git_sha}`",
        f"- **Dataset**: `{run.dataset_version}` · **Harness**: `{run.harness_version}`",
        f"- **Target**: `{run.target}` · **Model**: `{model}`",
        f"- **Budget**: spent ${run.budget_spent_usd:.4f} / cap ${run.budget_cap_usd:.2f}"
        + (" · **ABORTED on budget**" if run.aborted_on_budget else ""),
        "",
        "## Aggregates",
        "",
    ]
    for key, value in run.aggregates.items():
        lines.append(f"- `{key}`: {value}")
    lines += ["", "## Gates", "", "| Gate | pass | fail | not-run |", "| --- | --- | --- | --- |"]
    for name, bucket in sorted(_gate_counts(run).items()):
        lines.append(f"| {name} | {bucket['pass']} | {bucket['fail']} | {bucket['not-run']} |")
    failures = run.gate_failures()
    if failures:
        lines += ["", "## Failing cases", ""]
        for gate, case_ids in sorted(failures.items()):
            lines.append(f"- **{gate}**: {', '.join(case_ids)}")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_junit_xml(run: EvalRun, path: Path) -> None:
    """One JUnit testcase per (case, gate) so CI renders the gate vector."""
    failures = 0
    skipped = 0
    testcases: list[str] = []
    for result in run.results:
        for gate, status in result.gates.items():
            name = escape(f"{result.case_id}::{gate}")
            classname = escape(result.family)
            if status == GateStatus.FAIL:
                failures += 1
                testcases.append(
                    f'    <testcase classname="{classname}" name="{name}">'
                    f'<failure message="gate failed">{escape(gate)}</failure></testcase>'
                )
            elif status == GateStatus.NOT_RUN:
                skipped += 1
                testcases.append(
                    f'    <testcase classname="{classname}" name="{name}"><skipped/></testcase>'
                )
            else:
                testcases.append(f'    <testcase classname="{classname}" name="{name}"/>')
    total = len(testcases)
    body = "\n".join(testcases)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuite name="eval-harness" tests="{total}" failures="{failures}" '
        f'skipped="{skipped}">\n{body}\n</testsuite>\n'
    )
    path.write_text(xml, encoding="utf-8")


def write_checksums(paths: list[Path], path: Path) -> None:
    """Write ``<sha256>  <name>`` for each artifact, for integrity on promotion."""
    lines = []
    for artifact in paths:
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        lines.append(f"{digest}  {artifact.name}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_bundle(run: EvalRun, out_dir: Path, *, model: str, git_sha: str) -> list[Path]:
    """Write the full (reduced) artifact bundle and return the file paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "manifest.json"
    cases = out_dir / "cases.jsonl"
    summary_json = out_dir / "summary.json"
    summary_md = out_dir / "summary.md"
    junit = out_dir / "junit.xml"
    write_run_manifest(run, manifest, model=model, git_sha=git_sha)
    write_cases_jsonl(run, cases)
    write_summary_json(run, summary_json)
    write_summary_md(run, summary_md, model=model, git_sha=git_sha)
    write_junit_xml(run, junit)
    artifacts = [manifest, cases, summary_json, summary_md, junit]
    checksums = out_dir / "checksums.sha256"
    write_checksums(artifacts, checksums)
    return [*artifacts, checksums]
