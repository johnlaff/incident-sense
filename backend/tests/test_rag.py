"""Tests for the RAG pipeline with all external services mocked.

A scripted ``FakeLLM`` returns different canned outputs depending on which step
is calling it (it keys off a phrase in the system prompt), so we can exercise
the whole pipeline deterministically and offline.
"""

from __future__ import annotations

from incident_sense.config import Settings
from incident_sense.models import Classification, SuggestRequest
from incident_sense.rag import pipeline
from incident_sense.rag.clients import RagDeps, RetrievedHit


class FakeLLM:
    """Returns canned text per pipeline step, based on the system prompt."""

    def __init__(
        self,
        *,
        verdicts: str = "[]",
        classification: str = "PROCEDENTE",
        suggestion: str = "Reinicie o serviço. [INC0000001]",
        query: str = "pix timeout",
    ) -> None:
        self.verdicts = verdicts
        self.classification = classification
        self.suggestion = suggestion
        self.query = query

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
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
    def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class FakeRetriever:
    def __init__(self, hits: list[RetrievedHit]) -> None:
        self._hits = hits

    def search(
        self, vector: list[float], *, top_k: int, query_filter: object | None = None
    ) -> list[RetrievedHit]:
        return self._hits[:top_k]


def _hit(number: str, score: float, **payload: object) -> RetrievedHit:
    base = {
        "number": number,
        "short_description": f"desc {number}",
        "cmdb_ci": "PIX-Core",
        "category": "Pagamentos",
        "resolution_notes": f"resolucao {number}",
        "close_code": "Resolvido (Causa Raiz)",
    }
    base.update(payload)
    return RetrievedHit(number=number, score=score, payload=base)


def _deps(llm: FakeLLM, hits: list[RetrievedHit]) -> RagDeps:
    return RagDeps(llm=llm, embeddings=FakeEmbeddings(), retriever=FakeRetriever(hits))


def _request() -> SuggestRequest:
    return SuggestRequest(
        short_description="Pix sem comprovante",
        description="Cliente fez Pix, valor debitado, sem comprovante.",
    )


# --- step-level tests --------------------------------------------------------
def test_build_prefilter_none_without_hints() -> None:
    assert pipeline.build_prefilter(_request()) is None


def test_build_prefilter_uses_category_and_ci() -> None:
    request = SuggestRequest(
        short_description="x", description="y", category="Pagamentos", cmdb_ci="PIX-Core"
    )
    query_filter = pipeline.build_prefilter(request)
    assert query_filter is not None
    assert len(query_filter.should) == 2


def test_retrieve_drops_below_similarity_floor() -> None:
    deps = _deps(FakeLLM(), [_hit("INC1", 0.9), _hit("INC2", 0.2)])
    kept = pipeline.retrieve(deps, [0.0], top_k=5, min_similarity=0.4, query_filter=None)
    assert [hit.number for hit in kept] == ["INC1"]


def test_post_filter_annotates_survival_and_reason() -> None:
    verdicts = (
        '[{"number": "INC1", "relevant": true, "reason": "mesma causa"},'
        ' {"number": "INC2", "relevant": false, "reason": "so palavras"}]'
    )
    deps = _deps(FakeLLM(verdicts=verdicts), [])
    nodes = pipeline.post_filter(deps, _request(), [_hit("INC1", 0.9), _hit("INC2", 0.8)])
    survival = {n.node.metadata["number"]: n.node.metadata["survived"] for n in nodes}
    assert survival == {"INC1": True, "INC2": False}
    # Surviving candidates come first.
    assert nodes[0].node.metadata["number"] == "INC1"


def test_classify_follows_llm_verdict_not_retrieval() -> None:
    # The verdict is about the ticket itself, independent of retrieval: a real
    # incident with no surviving candidate is still PROCEDENTE...
    deps = _deps(FakeLLM(classification="PROCEDENTE"), [])
    assert pipeline.classify(deps, _request(), []) is Classification.PROCEDENTE
    # ...and a non-incident is IMPROCEDENTE even if candidates survived.
    deps = _deps(FakeLLM(classification="IMPROCEDENTE"), [])
    surviving = pipeline.post_filter(
        _deps(FakeLLM(verdicts='[{"number": "INC1", "relevant": true, "reason": "x"}]'), []),
        _request(),
        [_hit("INC1", 0.9)],
    )
    assert pipeline.classify(deps, _request(), surviving) is Classification.IMPROCEDENTE


def test_strip_redundant_title_drops_leading_heading() -> None:
    raw = "**Sugestão de Resolução:**\n\nReinicie o serviço. [INC0000001]"
    assert pipeline._strip_redundant_title(raw) == "Reinicie o serviço. [INC0000001]"
    # Also a bold "Resolução:" label.
    assert pipeline._strip_redundant_title("**Resolução:**\n\nfoo") == "foo"
    # A normal first sentence is left untouched.
    body = "Reinicie o serviço. [INC0000001]"
    assert pipeline._strip_redundant_title(body) == body
    # A genuine bolded diagnosis (no "sugest", no trailing colon) is preserved.
    diag = "**Falha no PIX-Core**\n\nReinicie o serviço."
    assert pipeline._strip_redundant_title(diag) == diag


# --- end-to-end pipeline -----------------------------------------------------
def test_run_suggestion_procedente() -> None:
    verdicts = (
        '[{"number": "INC1", "relevant": true, "reason": "mesma causa"},'
        ' {"number": "INC2", "relevant": false, "reason": "irrelevante"}]'
    )
    deps = _deps(
        FakeLLM(verdicts=verdicts, classification="PROCEDENTE"),
        [_hit("INC1", 0.88), _hit("INC2", 0.61)],
    )
    response = pipeline.run_suggestion(_request(), deps, Settings())

    assert response.classification is Classification.PROCEDENTE
    assert response.suggestion is not None
    assert response.referenced_incidents == ["INC1"]
    # Both candidates are surfaced with their scores; only INC1 survived.
    by_number = {c.number: c for c in response.candidates}
    assert by_number["INC1"].survived_postfilter is True
    assert by_number["INC1"].similarity == 0.88
    assert by_number["INC2"].survived_postfilter is False
    assert by_number["INC2"].postfilter_reason == "irrelevante"


def test_run_suggestion_improcedente_self_service() -> None:
    # A non-incident (e.g. "esqueci minha senha") is IMPROCEDENTE even when a
    # vocabulary-similar case is retrieved and survives the post-filter.
    verdicts = '[{"number": "INC1", "relevant": true, "reason": "parecido"}]'
    deps = _deps(FakeLLM(verdicts=verdicts, classification="IMPROCEDENTE"), [_hit("INC1", 0.7)])
    response = pipeline.run_suggestion(_request(), deps, Settings())

    assert response.classification is Classification.IMPROCEDENTE
    assert response.suggestion is None
    assert response.referenced_incidents == []


def test_run_suggestion_procedente_without_base() -> None:
    # A real incident whose candidates are all dropped by the post-filter stays
    # PROCEDENTE but carries no grounded suggestion (the "sem base ainda" path).
    verdicts = '[{"number": "INC1", "relevant": false, "reason": "nada a ver"}]'
    deps = _deps(FakeLLM(verdicts=verdicts, classification="PROCEDENTE"), [_hit("INC1", 0.7)])
    response = pipeline.run_suggestion(_request(), deps, Settings())

    assert response.classification is Classification.PROCEDENTE
    assert response.suggestion is None
    assert response.referenced_incidents == []
    assert response.candidates[0].survived_postfilter is False
