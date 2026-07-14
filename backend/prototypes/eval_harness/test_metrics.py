"""Hermetic pytest suite — the PR gate, made concrete.

PROTOTYPE. Demonstrates decision #7: the harness core (schemas, metrics,
adapters, judges, runner) is fully covered by offline, zero-cost pytest, while
the money-spending runner stays out of ``testpaths``. Run explicitly:

    cd backend && uv run python -m pytest prototypes/eval_harness/test_metrics.py -q

``make test`` (testpaths=["tests"]) never collects this file, so the demo and
these tests never trigger a paid call.
"""

from __future__ import annotations

import asyncio
import math
from pathlib import Path

from .adapters import InProcessRagTarget
from .fixtures import evidence_corpus
from .judges import FakeDeterministicJudge, HeuristicGroundednessJudge, JudgeInput
from .metrics import (
    citation_structural_validity,
    deterministic_metrics,
    forged_citation_count,
    hit_at_k,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from .runner import (
    RUBRIC_VERSION,
    BudgetLedger,
    _assign_gates,
    _verdict,
    load_cases,
    load_manifest,
    run_suite,
)
from .schema import (
    AnswerObservation,
    CaseResult,
    EvalCase,
    EvalExecution,
    EvalRun,
    Expected,
    GateStatus,
    ObservedCitation,
    Route,
)

_HERE = Path(__file__).parent
_MANIFEST = _HERE / "dataset" / "manifest.json"


# --- Retrieval metrics (hand-computed expectations) --------------------------
_GOLD = {"A": 2, "B": 1, "C": 2}
_RANKED = ["A", "X", "B"]  # X is irrelevant (grade 0)


def test_precision_recall_hit_mrr() -> None:
    assert precision_at_k(_RANKED, _GOLD, k=3).value == 2 / 3
    assert recall_at_k(_RANKED, _GOLD, k=3).value == 2 / 3
    assert hit_at_k(_RANKED, _GOLD, k=3).value == 1.0
    assert mrr(_RANKED, _GOLD).value == 1.0  # first relevant at position 1


def test_ndcg_uses_graded_relevance() -> None:
    # DCG = 2/log2(2) + 0/log2(3) + 1/log2(4) = 2.5
    # IDCG (ideal [2,2,1]) = 2 + 2/log2(3) + 1/log2(4) = 3.76186
    dcg = 2 / math.log2(2) + 0 / math.log2(3) + 1 / math.log2(4)
    idcg = 2 / math.log2(2) + 2 / math.log2(3) + 1 / math.log2(4)
    result = ndcg_at_k(_RANKED, _GOLD, k=3)
    assert result.value is not None
    assert math.isclose(result.value, dcg / idcg, rel_tol=1e-9)


def test_zero_denominator_is_not_applicable() -> None:
    # No gold relevance -> recall/ndcg cannot be computed, must be not_applicable.
    assert recall_at_k(["A"], {}, k=5).not_applicable
    assert ndcg_at_k(["A"], {}, k=5).not_applicable


def test_duplicate_ids_do_not_inflate_metrics() -> None:
    # A repeated id must not push recall past 1.0 or nDCG past its ideal.
    assert recall_at_k(["A", "A"], {"A": 2}, k=2).value == 1.0
    assert ndcg_at_k(["A", "A"], {"A": 2}, k=2).value == 1.0
    assert precision_at_k(["A", "A"], {"A": 2}, k=2).value == 0.5  # dedup -> 1 hit / k=2


# --- Citation metrics --------------------------------------------------------
def test_citation_validity_and_forged_detection() -> None:
    allowed = ["INC-ANALISE-001", "INC0042001"]
    good = [ObservedCitation(incident_id="INC0042001")]
    forged = [ObservedCitation(incident_id="INC9999999")]
    assert citation_structural_validity(good, allowed).value == 1.0
    assert forged_citation_count(good, allowed).value == 0.0
    assert citation_structural_validity(forged, allowed).value == 0.0
    assert forged_citation_count(forged, allowed).value == 1.0


def test_forged_citation_fails_hard_gate() -> None:
    # A forged citation must fail the citation-structural hard gate.
    case = EvalCase(
        case_id="x",
        locale="pt-BR",
        family="grounded-answer",
        incident_id="INC-ANALISE-001",
        turns=[{"role": "user", "content": "?"}],
        expected=Expected(route=Route.RETRIEVE_AND_ANSWER, allowed_sources=["INC-ANALISE-001"]),
    )
    execution = EvalExecution(
        case_id="x",
        target="unit",
        answer=AnswerObservation(
            route=Route.RETRIEVE_AND_ANSWER,
            classification="PROCEDENTE",
            citations=[ObservedCitation(incident_id="INC-FORGED-1")],
            text_present=True,
        ),
    )
    metrics = deterministic_metrics(
        pre_filter_ids=[],
        post_filter_ids=[],
        citations=execution.answer.citations if execution.answer else [],
        expected=case.expected,
        k=5,
    )
    gates = _assign_gates(case, execution, metrics)
    assert gates["citation-structural"] == GateStatus.FAIL


# --- In-process target contract ---------------------------------------------
def test_in_process_target_grounded_case() -> None:
    cases = {c.case_id: c for c in load_cases(_MANIFEST)}
    case = cases["grounded.pix-timeout.pt-BR.001"]
    execution = asyncio.run(InProcessRagTarget().run(case))
    assert execution.error is None
    assert execution.answer is not None
    assert execution.answer.route == Route.RETRIEVE_AND_ANSWER
    # The historical match is retrieved, survives, and is cited; distractor dropped.
    assert "INC0042001" in execution.retrieval.post_filter_ids
    assert "INC0042099" not in execution.retrieval.post_filter_ids
    assert [c.incident_id for c in execution.answer.citations] == ["INC0042001"]


def test_in_process_target_exposes_route_gap() -> None:
    # The current single-turn pipeline cannot take answer-general; the harness
    # surfaces the mismatch honestly instead of hiding it.
    cases = {c.case_id: c for c in load_cases(_MANIFEST)}
    case = cases["general.what-is-dlq.en.001"]
    execution = asyncio.run(InProcessRagTarget().run(case))
    assert execution.answer is not None
    assert execution.answer.route != case.expected.route


# --- Judge comparison (fake stub vs real heuristic) --------------------------
def test_fake_and_heuristic_judges_disagree() -> None:
    hallucinated = JudgeInput(
        metric="groundedness",
        claim="Reinicie o servidor de e-mail e limpe o cache do navegador.",
        evidence_texts=["Reprocessada a DLQ do DICT; confirmacoes reenviadas."],
    )
    fake = asyncio.run(FakeDeterministicJudge().score(hallucinated, RUBRIC_VERSION))
    heuristic = asyncio.run(HeuristicGroundednessJudge().score(hallucinated, RUBRIC_VERSION))
    assert fake.label == "grounded"  # stub trusts everything
    assert heuristic.label == "ungrounded"  # real grader catches the mismatch


# --- Budget ledger -----------------------------------------------------------
def test_budget_ledger_blocks_over_cap() -> None:
    ledger = BudgetLedger(cap_usd=0.10)
    ledger.reserve(0.06)
    ledger.settle(0.06, 0.05)  # committed 0.05
    ledger.reserve(0.04)  # committed 0.05 + reserved 0.04 = 0.09 <= 0.10 ok
    raised = False
    try:
        ledger.reserve(0.02)  # 0.05 + 0.04 + 0.02 = 0.11 > 0.10
    except Exception:  # noqa: BLE001 - BudgetExceeded
        raised = True
    assert raised


def test_run_suite_aborts_on_tiny_budget() -> None:
    cases = load_cases(_MANIFEST)
    started = "2026-07-13T00:00:00+00:00"
    manifest = load_manifest(_MANIFEST)
    run = asyncio.run(
        run_suite(
            cases,
            InProcessRagTarget(),
            [FakeDeterministicJudge()],
            evidence=evidence_corpus(),
            dataset_version=manifest.dataset_version,
            started=started,
            concurrency=1,
            budget_cap_usd=0.0,  # cannot afford any turn
        )
    )
    assert run.aborted_on_budget is True
    assert run.results == []


# --- Verdict: retrieval-recall floor actually blocks -------------------------
def _case_result(gates: dict[str, GateStatus]) -> CaseResult:
    return CaseResult(
        case_id="x",
        locale="pt-BR",
        family="grounded-answer",
        severity="P2",
        execution=EvalExecution(case_id="x", target="unit"),
        gates=gates,
    )


def _run_with(gates: dict[str, GateStatus]) -> EvalRun:
    run = EvalRun(dataset_version="t", started="2026-07-13T00:00:00+00:00", target="unit")
    run.results = [_case_result(gates)]
    return run


def test_retrieval_recall_floor_blocks_verdict() -> None:
    hard_ok = {
        "execution": GateStatus.PASS,
        "citation-structural": GateStatus.PASS,
        "isolation": GateStatus.PASS,
    }
    # With the recall floor failing (hard gates green) the verdict must be FAIL:
    # this is what NOTES claims is "enforced".
    assert _verdict(_run_with({**hard_ok, "retrieval-recall": GateStatus.FAIL})) == GateStatus.FAIL
    # Passing (or not-run) recall does not block.
    assert _verdict(_run_with({**hard_ok, "retrieval-recall": GateStatus.PASS})) == GateStatus.PASS
    assert (
        _verdict(_run_with({**hard_ok, "retrieval-recall": GateStatus.NOT_RUN})) == GateStatus.PASS
    )


# --- Manifest integrity ------------------------------------------------------
def test_manifest_integrity_passes_on_good_corpus() -> None:
    manifest = load_manifest(_MANIFEST)
    assert manifest.files[0].count == len(load_cases(_MANIFEST))


def test_manifest_integrity_fails_on_tamper(tmp_path: Path) -> None:
    # Copy the corpus but tamper with a byte; the hash check must reject it.
    manifest_text = (_MANIFEST).read_text(encoding="utf-8")
    cases_text = (_HERE / "dataset" / "cases.jsonl").read_text(encoding="utf-8")
    (tmp_path / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (tmp_path / "cases.jsonl").write_text(cases_text + '{"tampered": true}\n', encoding="utf-8")
    raised = False
    try:
        load_manifest(tmp_path / "manifest.json")
    except ValueError:
        raised = True
    assert raised
