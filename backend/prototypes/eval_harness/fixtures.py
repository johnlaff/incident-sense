"""Scripted scenarios that let the in-process target drive the REAL pipeline.

PROTOTYPE. Eval cases carry gold expectations, not fake wiring. To exercise the
real ``run_suggestion`` pipeline deterministically and offline, each case is
paired here with a ``Scenario``: the retriever hits and the canned LLM outputs
that reproduce a concrete pipeline behaviour. This mirrors the fakes in
``backend/tests/conftest.py`` / ``test_rag.py`` — the harness reuses the codebase's
own hermetic seams instead of inventing new ones.

In production the eval target would be the HTTP/SSE copiloto endpoint (not yet
built); these scenarios are the throwaway stand-in that proves the harness core
against the seams that exist today.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from incident_sense.rag.clients import RagDeps, RetrievedHit


class FakeLLM:
    """Canned per-step chat, keyed off a phrase in the system prompt.

    Mirrors ``tests/test_rag.py::FakeLLM`` so the in-process target runs the real
    pipeline with no network and fully deterministic output.
    """

    def __init__(
        self,
        *,
        query: str = "incident query",
        verdicts: str = "[]",
        classification: str = "PROCEDENTE",
        suggestion: str = "Reinicie o serviço. [INC0000001]",
    ) -> None:
        self.query = query
        self.verdicts = verdicts
        self.classification = classification
        self.suggestion = suggestion

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        """Return the canned output for whichever pipeline step is calling."""
        if "consulta de busca" in system:
            return self.query
        if "REALMENTE relevantes" in system:
            return self.verdicts
        if "INCIDENTE de verdade" in system:
            return f'{{"classification": "{self.classification}", "justification": "x"}}'
        if "sugestão de resolução" in system:
            return self.suggestion
        return ""


class FakeEmbeddings:
    """A constant vector — retrieval is scripted by the retriever, not the vector."""

    def embed(self, text: str) -> list[float]:
        """Return a fixed 3-dim vector (its value is irrelevant to the fake search)."""
        return [0.1, 0.2, 0.3]


class FakeRetriever:
    """Returns pre-scripted hits, respecting the requested ``top_k``."""

    def __init__(self, hits: list[RetrievedHit]) -> None:
        self._hits = hits

    def search(
        self, vector: list[float], *, top_k: int, query_filter: object | None = None
    ) -> list[RetrievedHit]:
        """Return the scripted hits truncated to ``top_k`` (filter ignored)."""
        return self._hits[:top_k]


def hit(
    number: str,
    score: float,
    *,
    short_description: str,
    resolution_notes: str,
    cmdb_ci: str = "PIX-Core",
    category: str = "Pagamentos",
) -> RetrievedHit:
    """Build a RetrievedHit with a realistic payload (mirrors test_rag helpers)."""
    return RetrievedHit(
        number=number,
        score=score,
        payload={
            "number": number,
            "short_description": short_description,
            "cmdb_ci": cmdb_ci,
            "category": category,
            "resolution_notes": resolution_notes,
            "close_code": "Resolvido (Causa Raiz)",
        },
    )


@dataclass(frozen=True)
class Scenario:
    """A case's scripted pipeline behaviour: request framing + fakes."""

    title: str  # short_description for the SuggestRequest
    llm: FakeLLM
    hits: list[RetrievedHit] = field(default_factory=list)
    category: str | None = None
    cmdb_ci: str | None = None

    def deps(self) -> RagDeps:
        """Assemble the injected fakes for the pipeline."""
        return RagDeps(
            llm=self.llm, embeddings=FakeEmbeddings(), retriever=FakeRetriever(self.hits)
        )


def _verdict_item(inc: str, relevant: bool) -> str:
    reason = "mesma causa raiz" if relevant else "apenas palavras em comum"
    return f'{{"number": "{inc}", "relevant": {str(relevant).lower()}, "reason": "{reason}"}}'


def _pix_verdicts(*, inc: str, relevant: bool) -> str:
    return f"[{_verdict_item(inc, relevant)}]"


def _grounded_verdicts(*, keep: str, drop: str) -> str:
    """Post-filter keeps the true match and drops the vocabulary-only distractor."""
    return f"[{_verdict_item(keep, True)}, {_verdict_item(drop, False)}]"


# Registry keyed by case_id. Each entry reproduces one concrete pipeline outcome.
SCENARIOS: dict[str, Scenario] = {
    # 1. Grounded answer, PT-BR: relevant history retrieved and cited.
    "grounded.pix-timeout.pt-BR.001": Scenario(
        title="Pix cai com timeout na confirmação",
        llm=FakeLLM(
            query="pix timeout confirmacao",
            verdicts=_grounded_verdicts(keep="INC0042001", drop="INC0042099"),
            classification="PROCEDENTE",
            suggestion=(
                "O Pix falha por timeout ao confirmar a transação no DICT.\n\n"
                "1. **Reprocessar a fila do DICT** — drenar a DLQ e reenviar as "
                "confirmações pendentes [INC0042001]."
            ),
        ),
        hits=[
            hit(
                "INC0042001",
                0.88,
                short_description="Timeout no Pix ao confirmar no DICT",
                resolution_notes="Reprocessada a DLQ do DICT; confirmações reenviadas.",
            ),
            hit(
                "INC0042099",
                0.55,
                short_description="Lentidão no internet banking",
                resolution_notes="Ampliado o pool de conexões.",
            ),
        ],
    ),
    # 2. Grounded answer, English twin of case 1 (same pair_id).
    "grounded.pix-timeout.en.001": Scenario(
        title="Pix fails with timeout on confirmation",
        llm=FakeLLM(
            query="pix timeout confirmation",
            verdicts=_grounded_verdicts(keep="INC0042001", drop="INC0042099"),
            classification="PROCEDENTE",
            suggestion=(
                "Pix is failing with a timeout when confirming the transaction at DICT.\n\n"
                "1. **Reprocess the DICT queue** — drain the DLQ and resend the "
                "pending confirmations [INC0042001]."
            ),
        ),
        hits=[
            hit(
                "INC0042001",
                0.87,
                short_description="Pix timeout confirming at DICT",
                resolution_notes="Reprocessed the DICT DLQ; confirmations resent.",
            ),
            hit(
                "INC0042099",
                0.54,
                short_description="Internet banking slowness",
                resolution_notes="Connection pool widened.",
            ),
        ],
    ),
    # 3. PROCEDENTE without base, PT-BR: real incident, all candidates dropped.
    "no-base.novel-outage.pt-BR.001": Scenario(
        title="Serviço de câmbio novo fora do ar",
        llm=FakeLLM(
            query="cambio indisponivel",
            verdicts=_pix_verdicts(inc="INC0042099", relevant=False),
            classification="PROCEDENTE",
            suggestion="unused",  # no suggestion is generated when nothing survives
        ),
        hits=[
            hit(
                "INC0042099",
                0.51,
                short_description="Lentidão no internet banking",
                resolution_notes="Ampliado o pool de conexões.",
            ),
        ],
    ),
    # 4. PROCEDENTE without base, English twin of case 3.
    "no-base.novel-outage.en.001": Scenario(
        title="New FX service is down",
        llm=FakeLLM(
            query="fx service down",
            verdicts=_pix_verdicts(inc="INC0042099", relevant=False),
            classification="PROCEDENTE",
            suggestion="unused",
        ),
        hits=[
            hit(
                "INC0042099",
                0.50,
                short_description="Internet banking slowness",
                resolution_notes="Connection pool widened.",
            ),
        ],
    ),
    # 5. IMPROCEDENTE, PT-BR: self-service, not a real incident (maps to refuse).
    "improcedente.password-reset.pt-BR.001": Scenario(
        title="Esqueci minha senha do portal",
        llm=FakeLLM(
            query="reset senha portal",
            verdicts=_pix_verdicts(inc="INC0042001", relevant=True),
            classification="IMPROCEDENTE",
            suggestion="unused",
        ),
        hits=[
            hit(
                "INC0042001",
                0.72,
                short_description="Timeout no Pix ao confirmar no DICT",
                resolution_notes="Reprocessada a DLQ do DICT.",
            ),
        ],
    ),
    # 6. General explanation, English: the CURRENT single-turn pipeline cannot
    #    take the ``answer-general`` route — this case deliberately exposes that
    #    gap (route mismatch) instead of hiding it. It graduates to a real pass
    #    only once the conversational endpoint exists.
    "general.what-is-dlq.en.001": Scenario(
        title="What is a dead letter queue?",
        llm=FakeLLM(
            query="dead letter queue concept",
            verdicts="[]",
            classification="PROCEDENTE",
            suggestion="unused",
        ),
        hits=[],
    ),
}


def evidence_corpus() -> dict[str, str]:
    """Map every scripted incident id -> its resolution text (for judges).

    Stands in for the real evidence store: a groundedness judge needs the text of
    a cited incident to decide whether it supports a claim.
    """
    corpus: dict[str, str] = {}
    for scenario in SCENARIOS.values():
        for scripted_hit in scenario.hits:
            payload = scripted_hit.payload
            corpus[scripted_hit.number] = str(payload.get("resolution_notes", ""))
    return corpus
