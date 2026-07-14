"""Async runner: budget reservation, bounded concurrency, checkpoint, verdict.

PROTOTYPE. The runner ties the pieces together for one suite:

1. Load + integrity-check the dataset (manifest sha256).
2. For each case, under a concurrency limit: reserve a worst-case cost envelope
   *before* running (the budget can never be exceeded by calls in flight),
   run the target, grade with deterministic metrics + judges, settle the actual
   cost, and checkpoint the ``CaseResult`` to JSONL as it completes.
3. Aggregate into a **vector of gates** — hard gates fail per case, quality
   gates carry a threshold — and emit a single ``EvalRun`` verdict.

Deliberately NOT named ``test_*`` and NOT importable by ``make test``: running a
suite is an explicit command (``run.py``), so no test run ever spends money.

SCOPE — what this prototype verdict enforces vs. defers. The point is to
demonstrate the gate-vector *mechanism*, not to be the production verdict:

* Enforced here: the hard gates ``execution`` / ``citation-structural`` /
  ``isolation`` (per case), and **one** representative quality floor
  (post-filter ``retrieval-recall`` ≥ 0.80). ``route-match`` is informational.
* Deferred to production (identical pattern, wired once thresholds exist): the
  full #20 §7 floor matrix (nDCG@5, groundedness, citation precision/coverage,
  policy recall, false-refusal, retention, contradiction, PT↔EN delta, latency)
  — those thresholds are *ratified post-baseline*, so hard-coding them now would
  contradict #20. Groundedness in particular MUST NOT gate here: the prototype's
  only real judge is the uncalibrated heuristic (#20 §4-5).
* ``execution`` is a simplification: the contract models transport error/timeout
  as a ≤2% rate with a rerun policy (#20 §9), then "suite invalid" if persistent.
  This prototype fails the suite on any single execution error instead.
* The ``P0/P1 zero-occurrence`` hard gate is a security-family concern; the
  benign demo corpus carries no P0/P1 security cases, so ``severity`` is loaded
  for reporting/quotas but not gated here (like the ``events.jsonl`` stub).
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from .adapters import InProcessRagTarget, TargetAdapter
from .judges import JudgeAdapter, JudgeInput
from .metrics import deterministic_metrics
from .pricing import worst_case_cost_usd
from .schema import (
    CaseResult,
    EvalCase,
    EvalExecution,
    EvalManifest,
    EvalRun,
    GateStatus,
    JudgeResult,
    MetricResult,
)

# Per-turn envelope from the eval contract (#20 §12): input ≤ 16k, output = 2k.
_MAX_INPUT_TOKENS = 16_000
_MAX_OUTPUT_TOKENS = 2_000
# Post-filter retrieval recall floor (#20 §7).
_RECALL_FLOOR = 0.80
RUBRIC_VERSION = "groundedness/v0-proto"


class BudgetExceededError(RuntimeError):
    """Raised when a reservation would push committed+reserved past the cap."""


class BudgetLedger:
    """Reserve worst-case cost before a call, then settle the actual cost.

    Invariant: ``committed + reserved`` never exceeds ``cap``. A reservation that
    would break it raises ``BudgetExceededError`` *before* any call is made.

    The cap holds only while ``actual ≤ reserved`` — which is guaranteed here
    because ``reserved`` is the worst-case token envelope and the fakes' actual
    cost is far below it. Two production hardenings are out of scope for the
    prototype: (1) reserve the judge envelope too (so ``actual`` includes judges),
    and record any reserve/actual divergence in the artifact (research §custo);
    (2) account money in integer cents / ``Decimal`` — binary ``float`` can make
    three ``reserve(0.1)`` sum to 0.30000000000000004 and reject a reservation
    exactly at a 0.30 cap.
    """

    def __init__(self, cap_usd: float) -> None:
        self._cap = cap_usd
        self._committed = 0.0
        self._reserved = 0.0

    def reserve(self, amount: float) -> None:
        """Hold ``amount`` against the cap, or raise if it would be exceeded."""
        if self._committed + self._reserved + amount > self._cap:
            raise BudgetExceededError(
                f"reserve {amount:.4f} would exceed cap {self._cap:.4f} "
                f"(committed {self._committed:.4f}, reserved {self._reserved:.4f})"
            )
        self._reserved += amount

    def settle(self, reserved: float, actual: float) -> None:
        """Release a reservation and commit the actual cost that was incurred."""
        self._reserved = max(0.0, self._reserved - reserved)
        self._committed += actual

    @property
    def committed(self) -> float:
        """Total actual cost committed so far."""
        return self._committed

    @property
    def peak_reserved(self) -> float:
        """Currently outstanding reservation (diagnostic)."""
        return self._reserved

    @property
    def cap(self) -> float:
        """The hard spend cap for this run."""
        return self._cap


# --- Dataset loading ---------------------------------------------------------
def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest(manifest_path: Path) -> EvalManifest:
    """Load and validate the manifest, verifying each file's content hash."""
    manifest = EvalManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest.files:
        target = manifest_path.parent / entry.path
        actual = _sha256(target)
        if actual != entry.sha256:
            raise ValueError(
                f"integrity check failed for {entry.path}: "
                f"manifest {entry.sha256[:12]}… != actual {actual[:12]}…"
            )
    return manifest


def load_cases(manifest_path: Path) -> list[EvalCase]:
    """Load every case referenced by a verified manifest, in file order."""
    manifest = load_manifest(manifest_path)
    cases: list[EvalCase] = []
    for entry in manifest.files:
        path = manifest_path.parent / entry.path
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                cases.append(EvalCase.model_validate_json(line))
    return cases


# --- Grading -----------------------------------------------------------------
def _assign_gates(
    case: EvalCase, execution: EvalExecution, metrics: list[MetricResult]
) -> dict[str, GateStatus]:
    """Turn raw metrics into pass/fail/not-run gate statuses for one case."""
    gates: dict[str, GateStatus] = {}

    # Execution health: a transport error blocks everything.
    if execution.error is not None:
        gates["execution"] = GateStatus.FAIL
        return gates
    gates["execution"] = GateStatus.PASS

    # Route match (hard-ish): the observed route equals the expected route.
    observed_route = execution.answer.route if execution.answer else None
    gates["route-match"] = (
        GateStatus.PASS if observed_route == case.expected.route else GateStatus.FAIL
    )

    # Citation structural validity + no forged ids (hard gate, 100% per case).
    by_name = {m.name: m for m in metrics}
    validity = by_name.get("citation-structural-validity")
    forged = by_name.get("forged-citations")
    if validity is None or validity.not_applicable:
        gates["citation-structural"] = GateStatus.NOT_RUN
    else:
        ok = validity.value == 1.0 and (forged is None or forged.value == 0.0)
        gates["citation-structural"] = GateStatus.PASS if ok else GateStatus.FAIL

    # Retrieval recall floor (post-filter), only where gold evidence exists.
    recall_post = next(
        (m for m in metrics if m.name.startswith("recall@") and m.slice.endswith("post")), None
    )
    if recall_post is None or recall_post.not_applicable:
        gates["retrieval-recall"] = GateStatus.NOT_RUN
    else:
        gates["retrieval-recall"] = (
            GateStatus.PASS if (recall_post.value or 0.0) >= _RECALL_FLOOR else GateStatus.FAIL
        )

    # Isolation (hard): no forbidden source cited or retrieved.
    forbidden = set(case.expected.forbidden_sources)
    cited = {c.incident_id for c in (execution.answer.citations if execution.answer else [])}
    retrieved = set(execution.retrieval.pre_filter_ids)
    leaked = forbidden & (cited | retrieved)
    gates["isolation"] = GateStatus.FAIL if leaked else GateStatus.PASS
    return gates


def _judge_inputs(case: EvalCase, execution: EvalExecution, evidence: dict[str, str]) -> JudgeInput:
    """Build a groundedness judge input from the answer text + cited evidence."""
    answer = execution.answer
    claim = (answer.answer_text if answer else "") or ""
    cited_ids = [c.incident_id for c in answer.citations] if answer else []
    evidence_texts = [evidence[i] for i in cited_ids if i in evidence]
    return JudgeInput(
        metric="groundedness",
        claim=claim,
        evidence_texts=evidence_texts,
        locale=case.locale,
        context=case.first_user_message(),
    )


async def _grade_case(
    case: EvalCase,
    execution: EvalExecution,
    judges: list[JudgeAdapter],
    evidence: dict[str, str],
    *,
    k: int,
) -> CaseResult:
    """Compute deterministic metrics + judge results + gates for one case."""
    answer = execution.answer
    metrics = deterministic_metrics(
        pre_filter_ids=execution.retrieval.pre_filter_ids,
        post_filter_ids=execution.retrieval.post_filter_ids,
        citations=answer.citations if answer else [],
        expected=case.expected,
        k=k,
        slice_=case.locale,
    )
    judge_results: list[JudgeResult] = []
    # Only grounded-answer families have operational claims worth judging.
    if answer and answer.answer_text and case.expected.operational_claims():
        judge_input = _judge_inputs(case, execution, evidence)
        for judge in judges:
            judge_results.append(await judge.score(judge_input, RUBRIC_VERSION))

    gates = _assign_gates(case, execution, metrics)
    return CaseResult(
        case_id=case.case_id,
        locale=case.locale,
        family=case.family,
        severity=case.severity,
        execution=execution,
        metrics=metrics,
        judge_results=judge_results,
        gates=gates,
    )


# --- Suite -------------------------------------------------------------------
async def run_suite(
    cases: list[EvalCase],
    target: TargetAdapter,
    judges: list[JudgeAdapter],
    *,
    evidence: dict[str, str],
    dataset_version: str,
    started: str,
    k: int = 5,
    concurrency: int = 4,
    budget_cap_usd: float = 0.50,
    model: str = "deepseek/deepseek-v4-flash",
    checkpoint_path: Path | None = None,
) -> EvalRun:
    """Run every case under a concurrency limit and a hard budget cap."""
    ledger = BudgetLedger(budget_cap_usd)
    semaphore = asyncio.Semaphore(concurrency)
    run = EvalRun(
        dataset_version=dataset_version,
        started=started,
        target=target.name,
        budget_cap_usd=budget_cap_usd,
    )
    # Worst-case envelope reserved before each case: the turn (16k/2k). The
    # prototype's judges are non-LLM (zero cost) so they are settled but not
    # separately reserved; the real harness reserves the judge envelope too, since
    # the cap must cover system + judges (#20 §8).
    per_turn_reserve = worst_case_cost_usd(
        model, max_input_tokens=_MAX_INPUT_TOKENS, max_output_tokens=_MAX_OUTPUT_TOKENS
    )
    checkpoint = checkpoint_path.open("w", encoding="utf-8") if checkpoint_path else None
    lock = asyncio.Lock()  # serialize the shared ledger + checkpoint writes

    async def _one(case: EvalCase) -> CaseResult | None:
        async with semaphore:
            async with lock:
                try:
                    ledger.reserve(per_turn_reserve)
                except BudgetExceededError:
                    run.aborted_on_budget = True
                    return None
            execution = await target.run(case)
            result = await _grade_case(case, execution, judges, evidence, k=k)
            async with lock:
                actual = execution.total_cost_usd() + sum(
                    j.cost_usd or 0.0 for j in result.judge_results
                )
                ledger.settle(per_turn_reserve, actual)
                if checkpoint is not None:
                    checkpoint.write(result.model_dump_json() + "\n")
                    checkpoint.flush()
            return result

    try:
        gathered = await asyncio.gather(*(_one(case) for case in cases))
    finally:
        if checkpoint is not None:
            checkpoint.close()

    run.results = [r for r in gathered if r is not None]
    run.budget_spent_usd = round(ledger.committed, 6)
    run.budget_reserved_usd = round(per_turn_reserve, 6)
    run.aggregates = _aggregate(run.results)
    run.verdict = _verdict(run)
    return run


# --- Aggregation & verdict ---------------------------------------------------
# The blocking gates this prototype demonstrates. This is a SUBSET of the #20
# gate matrix (see the module SCOPE note): the full numeric floor matrix and the
# P0/P1 security gate are deferred to production, where thresholds are ratified
# post-baseline. ``retrieval-recall`` is enforced as a floor in ``_assign_gates``.
_HARD_GATES = frozenset({"execution", "citation-structural", "isolation"})


def _aggregate(results: list[CaseResult]) -> dict[str, float]:
    """Macro-aggregate a few headline numbers (not a single quality index)."""
    if not results:
        return {}
    total = len(results)
    route_ok = sum(1 for r in results if r.gates.get("route-match") == GateStatus.PASS)
    recall_values = [
        m.value
        for r in results
        for m in r.metrics
        if m.name.startswith("recall@") and m.slice.endswith("post") and m.value is not None
    ]
    aggregates = {
        "cases": float(total),
        "route_match_rate": round(route_ok / total, 4),
    }
    if recall_values:
        aggregates["recall_post_mean"] = round(sum(recall_values) / len(recall_values), 4)
    # Groundedness is reported PER judge, never averaged across judges: mixing the
    # always-pass stub with the heuristic would be meaningless. In the real harness
    # a single calibrated judge gates this metric.
    by_judge: dict[str, list[float]] = {}
    for r in results:
        for j in r.judge_results:
            if j.metric == "groundedness" and j.score is not None:
                by_judge.setdefault(j.judge_requested, []).append(j.score)
    for judge_name, scores in sorted(by_judge.items()):
        aggregates[f"groundedness_mean:{judge_name}"] = round(sum(scores) / len(scores), 4)
    return aggregates


# Gates that block the verdict: the zero-tolerance hard gates plus the one
# quality floor this prototype actually enforces (``retrieval-recall`` ≥ 0.80).
# A ``NOT_RUN`` never blocks — only a ``FAIL`` does.
_BLOCKING_GATES = _HARD_GATES | frozenset({"retrieval-recall"})


def _verdict(run: EvalRun) -> GateStatus:
    """FAIL if any blocking gate fails on any case; otherwise PASS."""
    if not run.results:
        return GateStatus.NOT_RUN
    for result in run.results:
        for name, status in result.gates.items():
            if name in _BLOCKING_GATES and status == GateStatus.FAIL:
                return GateStatus.FAIL
    return GateStatus.PASS


def default_in_process_target(model: str = "deepseek/deepseek-v4-flash") -> InProcessRagTarget:
    """Convenience for the demo entrypoint and tests.

    The default model is illustrative only. In production the reference model's
    family must differ from the judge ladder's family (#20 §4): DeepSeek here
    would clash with the ladder's DeepSeek rung — harmless in the prototype
    (its judges are non-LLM), but the real config must not pair them.
    """
    return InProcessRagTarget(model=model)
