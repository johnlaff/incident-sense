"""JudgeAdapter: the port for semantic grading, plus two contrasting impls.

PROTOTYPE. The port is ``JudgeAdapter.score(JudgeInput, rubric_version) ->
JudgeResult`` (research §portas). The ticket asks to *compare*, not describe,
two ways to fill it without spending money:

* ``FakeDeterministicJudge`` — a trusting stub that always returns "grounded".
  Zero cost, fully deterministic. Its job is to keep the PR gate hermetic while
  exercising the port and the runner plumbing. It must never gate quality: a
  stub that always passes would hide every grounding failure.
* ``HeuristicGroundednessJudge`` — a **real** non-LLM grader: lexical overlap
  between a claim and its cited evidence. Also zero cost. It shows the port works
  with a non-trivial grader and — crucially — that a crude heuristic disagrees
  with the stub and is itself too blunt to gate, which is exactly why #20
  mandates a *calibrated* LLM ladder.

``OpenRouterLlmJudge`` is a stub: the calibrated instrument (DeepSeek → Flash-lite
→ 3.5-flash → Sonnet) lives behind this same port and costs money, so it is out
of scope for the no-spend prototype.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .schema import JudgeResult

# A tiny bilingual stopword set so overlap reflects content, not glue words.
_STOPWORDS = {
    "a",
    "o",
    "os",
    "as",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "no",
    "na",
    "um",
    "uma",
    "para",
    "por",
    "com",
    "que",
    "se",
    "ao",
    "the",
    "of",
    "and",
    "to",
    "in",
    "on",
    "for",
    "with",
    "is",
    "at",
    "an",
    "by",
    "be",
}


def _content_tokens(text: str) -> set[str]:
    """Lowercased word tokens minus stopwords and short noise."""
    words = "".join(c.lower() if c.isalnum() else " " for c in text).split()
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


@dataclass(frozen=True)
class JudgeInput:
    """Only the fields a rubric needs — never a whole SDK object."""

    metric: str
    claim: str
    evidence_texts: list[str] = field(default_factory=list)
    locale: str = "pt-BR"
    context: str = ""  # incident-under-analysis text, when the rubric needs it


class JudgeAdapter:
    """Structural base so both judges share the port signature (documentation)."""

    name: str = "base"

    async def score(self, judge_input: JudgeInput, rubric_version: str) -> JudgeResult:
        """Grade one judge input against a frozen rubric version."""
        raise NotImplementedError


class FakeDeterministicJudge(JudgeAdapter):
    """Always "grounded". Keeps the PR gate hermetic; never gates real quality."""

    name = "fake-deterministic"

    async def score(self, judge_input: JudgeInput, rubric_version: str) -> JudgeResult:
        """Return a fixed pass — a stub for plumbing, not a quality signal."""
        return JudgeResult(
            metric=judge_input.metric,
            rubric_version=rubric_version,
            judge_requested=self.name,
            judge_effective=self.name,
            provider="none",
            score=1.0,
            label="grounded",
            reason="stub judge: always grounded (plumbing only)",
            cost_usd=0.0,
            cost_source="reported",
        )


class HeuristicGroundednessJudge(JudgeAdapter):
    """Real, no-cost grader: lexical overlap of claim vs cited evidence."""

    name = "heuristic-overlap"

    def __init__(self, *, threshold: float = 0.2) -> None:
        self._threshold = threshold

    async def score(self, judge_input: JudgeInput, rubric_version: str) -> JudgeResult:
        """Grade groundedness as |claim ∩ evidence| / |claim| (lexical)."""
        claim_tokens = _content_tokens(judge_input.claim)
        evidence_tokens: set[str] = set()
        for text in judge_input.evidence_texts:
            evidence_tokens |= _content_tokens(text)

        if not claim_tokens:
            return JudgeResult(
                metric=judge_input.metric,
                rubric_version=rubric_version,
                judge_requested=self.name,
                judge_effective=self.name,
                provider="none",
                score=None,
                label="cannot-determine",
                reason="empty claim",
                cost_usd=0.0,
                cost_source="reported",
            )
        overlap = claim_tokens & evidence_tokens
        score = len(overlap) / len(claim_tokens)
        grounded = score >= self._threshold and bool(judge_input.evidence_texts)
        shared = ", ".join(sorted(overlap)[:6]) or "none"
        return JudgeResult(
            metric=judge_input.metric,
            rubric_version=rubric_version,
            judge_requested=self.name,
            judge_effective=self.name,
            provider="none",
            score=round(score, 4),
            label="grounded" if grounded else "ungrounded",
            reason=f"lexical overlap {score:.2f} (shared: {shared})",
            cost_usd=0.0,
            cost_source="reported",
        )


class OpenRouterLlmJudge(JudgeAdapter):
    """STUB — the calibrated LLM judge ladder behind the same port (#20 §4).

    The real instrument is frozen (id, prompt, temperature, parser, rubric
    version) and calibrated against human gold per language before it may gate.
    It runs only in the protected RC job, obeys ZDR and the provider allowlist,
    and its cost counts toward the same budget cap as the system under test. Out
    of scope for the no-spend prototype.
    """

    name = "openrouter-llm-ladder"

    async def score(self, judge_input: JudgeInput, rubric_version: str) -> JudgeResult:
        """Not implemented: would spend money and needs calibration first."""
        raise NotImplementedError(
            "OpenRouterLlmJudge spends money and must be calibrated against human "
            "gold before gating (#20 §4-5); not run in the prototype."
        )
