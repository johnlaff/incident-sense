"""Runnable demo of the harness — the real runner, deliberately NOT a test.

PROTOTYPE. One command, no keys, no cost (uses the in-process target + fakes):

    cd backend && uv run python -m prototypes.eval_harness.run

It loads the bilingual corpus, runs the suite, writes the artifact bundle to
``_artifacts/`` and prints ``summary.md`` plus the fake-vs-heuristic judge
comparison the ticket asks for. This module is not named ``test_*`` and is not in
``testpaths``, so ``make test`` never runs it — the point of the CI-separation
decision made concrete.
"""

from __future__ import annotations

import asyncio
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from .fixtures import evidence_corpus
from .judges import FakeDeterministicJudge, HeuristicGroundednessJudge, JudgeInput
from .runner import RUBRIC_VERSION, load_cases, load_manifest, run_suite
from .schema import EvalRun

_HERE = Path(__file__).parent
_MANIFEST = _HERE / "dataset" / "manifest.json"
_ARTIFACTS = _HERE / "_artifacts"
_MODEL = "deepseek/deepseek-v4-flash"


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
        )
        return out.stdout.strip() or "unknown"
    except (subprocess.SubprocessError, OSError):
        return "unknown"


async def _run() -> EvalRun:
    from .adapters import InProcessRagTarget

    manifest = load_manifest(_MANIFEST)  # integrity-checks the corpus
    cases = load_cases(_MANIFEST)
    target = InProcessRagTarget(model=_MODEL)
    judges = [FakeDeterministicJudge(), HeuristicGroundednessJudge()]
    started = datetime.now(UTC).isoformat()
    return await run_suite(
        cases,
        target,
        judges,
        evidence=evidence_corpus(),
        dataset_version=manifest.dataset_version,
        started=started,
        concurrency=4,
        budget_cap_usd=0.50,
        model=_MODEL,
        checkpoint_path=_ARTIFACTS / "cases.checkpoint.jsonl",
    )


async def _judge_comparison() -> str:
    """Run both judges on the same input to show they disagree (ticket ask)."""
    grounded = JudgeInput(
        metric="groundedness",
        claim="Reprocessar a fila do DICT e drenar a DLQ para reenviar as confirmacoes.",
        evidence_texts=["Reprocessada a DLQ do DICT; confirmacoes reenviadas."],
        locale="pt-BR",
    )
    hallucinated = JudgeInput(
        metric="groundedness",
        claim="Reinicie o servidor de e-mail e limpe o cache do navegador.",
        evidence_texts=["Reprocessada a DLQ do DICT; confirmacoes reenviadas."],
        locale="pt-BR",
    )
    fake, heuristic = FakeDeterministicJudge(), HeuristicGroundednessJudge()
    lines = ["", "## Judge comparison (fake stub vs real heuristic)", ""]
    lines.append("| claim | fake | heuristic |")
    lines.append("| --- | --- | --- |")
    for label, ji in (("grounded claim", grounded), ("hallucinated claim", hallucinated)):
        f = await fake.score(ji, RUBRIC_VERSION)
        h = await heuristic.score(ji, RUBRIC_VERSION)
        lines.append(f"| {label} | {f.label} | {h.label} ({h.score}) |")
    lines.append("")
    lines.append(
        "> The stub passes everything; the heuristic catches the hallucination but is "
        "too blunt to gate — which is why #20 mandates a *calibrated* LLM judge."
    )
    return "\n".join(lines)


def main() -> None:
    """Run the demo suite, write artifacts, print the summary."""
    from .writers import write_bundle

    _ARTIFACTS.mkdir(parents=True, exist_ok=True)
    run = asyncio.run(_run())
    git_sha = _git_sha()
    paths = write_bundle(run, _ARTIFACTS, model=_MODEL, git_sha=git_sha)
    summary_md = next(p for p in paths if p.name == "summary.md")
    print(summary_md.read_text(encoding="utf-8"))
    print(asyncio.run(_judge_comparison()))
    print(f"\nArtifacts written to {_ARTIFACTS}/")
    for path in paths:
        print(f"  - {path.name}")


if __name__ == "__main__":
    main()
