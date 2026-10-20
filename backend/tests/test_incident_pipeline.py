"""The incident suggestion pipeline as described in João's article.

Seven steps (load, AI summary, embedding of the summary with categoria,
subcategoria and empresa, three-layer retrieval, context, suggestion with
sources, publication on the incident) with a procedência gate between context
and suggestion. Every external service is a fake.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from qdrant_client import models as qm

from incident_sense.config import Settings
from incident_sense.data.work_notes import WorkNotesStore
from incident_sense.models import (
    Classification,
    Impact,
    Incident,
    IncidentState,
    Priority,
    SuggestRequest,
    Urgency,
)
from incident_sense.rag import pipeline
from incident_sense.rag.clients import RagDeps, RetrievedHit
from incident_sense.rag.tags import TagCatalog


class ScriptedLLM:
    """Canned text per step, keyed off a phrase in the system prompt."""

    def __init__(
        self,
        *,
        summary: str = '{"resumo": "Pix com timeout na confirmação", "tags": []}',
        verdicts: str | None = None,
        classification: str = "PROCEDENTE",
        suggestion: str = "Ajuste o timeout do DICT [INC0000001].",
        postfilter_error: Exception | None = None,
    ) -> None:
        self.summary = summary
        self.verdicts = verdicts
        self.classification = classification
        self.suggestion = suggestion
        self.postfilter_error = postfilter_error
        self.calls: list[str] = []

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        if "consulta de busca" in system:
            self.calls.append("resumir")
            return self.summary
        if "REALMENTE relevantes" in system:
            self.calls.append("posfiltro")
            if self.postfilter_error is not None:
                raise self.postfilter_error
            if self.verdicts is not None:
                return self.verdicts
            # Default: keep everything listed in the prompt.
            numbers = [line.split(":")[0][2:] for line in user.splitlines() if line[:2] == "- "]
            items = ",".join(
                f'{{"number": "{n}", "relevant": true, "reason": "mesma causa"}}' for n in numbers
            )
            return f"[{items}]"
        if "INCIDENTE de verdade" in system:
            self.calls.append("decidir")
            return f'{{"classification": "{self.classification}", "justification": "falha real"}}'
        if "sugestão de resolução" in system:
            self.calls.append("sugerir")
            return self.suggestion
        return ""


class RecordingEmbeddings:
    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed(self, text: str) -> list[float]:
        self.texts.append(text)
        return [0.1, 0.2, 0.3]


class RecordingRetriever:
    def __init__(self, hits: list[RetrievedHit]) -> None:
        self._hits = hits
        self.calls: list[dict[str, Any]] = []

    def search(
        self, vector: list[float], *, top_k: int, query_filter: Any | None = None
    ) -> list[RetrievedHit]:
        self.calls.append({"top_k": top_k, "filter": query_filter})
        return self._hits[:top_k]


def _inc_hit(number: str, score: float) -> RetrievedHit:
    return RetrievedHit(
        number=number,
        score=score,
        payload={
            "number": number,
            "short_description": f"Pix lento {number}",
            "cmdb_ci": "PIX-Core",
            "category": "Pagamentos",
            "resolution_notes": f"resolução de {number}",
            "close_code": "Resolvido (Causa Raiz)",
            "tags": ["pix", "pagamentos", "timeout"],
        },
    )


def _prb_hit(number: str, score: float) -> RetrievedHit:
    return RetrievedHit(
        number=number,
        score=score,
        payload={
            "number": number,
            "short_description": f"Problema {number}",
            "root_cause": "pool de threads saturado",
            "workaround": "aumentar workers",
            "permanent_fix": "autoescalonamento",
            "linked_incidents": ["INC0000001", "INC0000002"],
        },
    )


def _incident(number: str = "INC0099999", tags: list[str] | None = None) -> Incident:
    return Incident(
        number=number,
        short_description="Pix sem comprovante",
        description="Cliente fez Pix, valor debitado, sem comprovante há duas horas.",
        category="Pagamentos",
        subcategory="Pix",
        cmdb_ci="PIX-Core",
        assignment_group="Service-Desk-N1",
        priority=Priority.HIGH,
        impact=Impact.HIGH,
        urgency=Urgency.HIGH,
        state=IncidentState.NEW,
        opened_at=datetime(2026, 6, 15, 9, 0),
        tags=tags if tags is not None else ["pix", "timeout", "dados-incompletos"],
    )


class Lookup:
    def __init__(self, *incidents: Incident) -> None:
        self._by = {i.number: i for i in incidents}

    def get(self, number: str) -> Incident | None:
        return self._by.get(number)


CATALOG = TagCatalog(
    vocabulary=frozenset({"pix", "pagamentos", "timeout", "boleto", "login"}),
    by_subcategory={("Pagamentos", "Pix"): ("pix", "pagamentos", "timeout")},
)


def _settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def _run(
    llm: ScriptedLLM | None = None,
    *,
    incident_hits: list[RetrievedHit] | None = None,
    problem_hits: list[RetrievedHit] | None = None,
    incident: Incident | None = None,
    settings: Settings | None = None,
    request: SuggestRequest | None = None,
) -> tuple[Any, dict[str, Any]]:
    llm = llm or ScriptedLLM()
    embeddings = RecordingEmbeddings()
    incidents = RecordingRetriever(
        incident_hits if incident_hits is not None else [_inc_hit("INC0000001", 0.91)]
    )
    problems = RecordingRetriever(
        problem_hits if problem_hits is not None else [_prb_hit("PRB0004101", 0.86)]
    )
    notes = WorkNotesStore()
    record = incident or _incident()
    deps = RagDeps(
        llm=llm,
        embeddings=embeddings,
        retriever=incidents,
        problem_retriever=problems,
        catalog=CATALOG,
        incidents=Lookup(record),
        notes=notes,
    )
    req = request or SuggestRequest(
        number=record.number,
        short_description=record.short_description,
        description=record.description,
    )
    response = pipeline.run_suggestion(req, deps, settings or _settings())
    spies = {
        "llm": llm,
        "embeddings": embeddings,
        "incidents": incidents,
        "problems": problems,
        "notes": notes,
    }
    return response, spies


# --- the seven steps ----------------------------------------------------------
def test_response_exposes_the_seven_steps_and_the_procedencia_gate() -> None:
    response, _ = _run()

    assert [(s.id, s.order, s.gate) for s in response.steps] == [
        ("carregar", 1, False),
        ("resumir", 2, False),
        ("embedding", 3, False),
        ("recuperar", 4, False),
        ("contexto", 5, False),
        ("decidir", 5, True),
        ("sugerir", 6, False),
        ("publicar", 7, False),
    ]
    assert all(step.decision for step in response.steps)
    assert all(step.status == "concluida" for step in response.steps)


def test_load_step_reads_the_incident_from_the_base() -> None:
    response, _ = _run()
    load = response.steps[0]
    assert response.incident_number == "INC0099999"
    assert "INC0099999" in load.decision
    assert "Banco Meridiano" in load.decision


def test_query_is_the_summary_plus_categoria_subcategoria_and_empresa() -> None:
    response, spies = _run()

    (embedded,) = spies["embeddings"].texts
    assert embedded == response.query_text
    assert embedded.startswith("Pix com timeout na confirmação")
    assert "Categoria: Pagamentos" in embedded
    assert "Subcategoria: Pix" in embedded
    assert "Empresa: Banco Meridiano" in embedded
    # Never the raw ticket text.
    assert "duas horas" not in embedded
    assert response.summarized_query == "Pix com timeout na confirmação"


def test_response_previews_the_query_vector_without_shipping_it() -> None:
    response, _ = _run()

    # The fake embedder returns a 3-value vector: all of it fits the preview.
    assert response.dims == 3
    assert response.embedding_preview == [0.1, 0.2, 0.3]


def test_embedding_preview_keeps_the_first_values_rounded() -> None:
    vector = [i / 7 - 0.5 for i in range(3072)]

    preview = pipeline.embedding_preview(vector)

    assert len(preview) == 24
    assert preview[0] == -0.5
    assert preview[1] == round(1 / 7 - 0.5, 3)
    assert all(len(str(v).split(".")[-1]) <= 3 for v in preview)


# --- layer 1: semantic tags -----------------------------------------------------
def test_semantic_tags_decide_where_to_search() -> None:
    response, spies = _run()

    tags = response.retrieval.tags
    # The incident's own tags, restricted to the semantic vocabulary.
    assert tags.tags == ["pix", "timeout"]
    assert tags.source == "incidente"
    assert tags.filter_applied is True
    for retriever in (spies["incidents"], spies["problems"]):
        query_filter = retriever.calls[0]["filter"]
        assert isinstance(query_filter, qm.Filter)
        (condition,) = query_filter.must
        assert condition.key == "tags"
        assert set(condition.match.any) == {"pix", "timeout"}


def test_tags_come_from_the_ai_summary_when_the_incident_has_none() -> None:
    llm = ScriptedLLM(summary='{"resumo": "Boleto sem linha", "tags": ["boleto", "inventada"]}')
    response, _ = _run(llm, incident=_incident(tags=[]))
    assert response.retrieval.tags.tags == ["boleto"]
    assert response.retrieval.tags.source == "ia"


def test_tags_fall_back_to_the_catalog_by_subcategory() -> None:
    llm = ScriptedLLM(summary="Pix com timeout")  # not JSON: no tags from the AI
    response, _ = _run(llm, incident=_incident(tags=[]))
    assert response.summarized_query == "Pix com timeout"
    assert response.retrieval.tags.tags == ["pix", "pagamentos", "timeout"]
    assert response.retrieval.tags.source == "catalogo"


def test_without_any_tag_the_search_is_broad() -> None:
    llm = ScriptedLLM(summary="Algo estranho")
    request = SuggestRequest(
        short_description="Algo estranho", description="Sem detalhes.", category="Outros"
    )
    response, spies = _run(llm, request=request)
    assert response.retrieval.tags.tags == []
    assert response.retrieval.tags.filter_applied is False
    assert spies["incidents"].calls[0]["filter"] is None
    assert response.incident_number is None


# --- layer 2: vector ------------------------------------------------------------
def test_threshold_and_top_k_default_to_the_article_values() -> None:
    settings = _settings()
    assert settings.retrieval_min_similarity == 0.8
    assert settings.incident_top_k == 5
    assert settings.problem_top_k == 10

    scores = [0.95, 0.9, 0.8, 0.79, 0.7, 0.6, 0.5]
    hits = [_inc_hit(f"INC000000{i}", score) for i, score in enumerate(scores, start=1)]
    response, spies = _run(incident_hits=hits, settings=settings)

    assert spies["incidents"].calls[0]["top_k"] == 5
    assert spies["problems"].calls[0]["top_k"] == 10
    vector = response.retrieval.vector
    assert vector.min_similarity == 0.8
    assert [(h.number, h.passed) for h in vector.incidents] == [
        ("INC0000001", True),
        ("INC0000002", True),
        ("INC0000003", True),
        ("INC0000004", False),
        ("INC0000005", False),
    ]
    # Only what passed the floor reaches the post-filter.
    assert [c.number for c in response.candidates] == ["INC0000001", "INC0000002", "INC0000003"]


def test_threshold_and_top_k_come_from_configuration() -> None:
    settings = _settings(retrieval_min_similarity=0.5, incident_top_k=2, problem_top_k=3)
    hits = [_inc_hit("INC0000001", 0.6), _inc_hit("INC0000002", 0.55), _inc_hit("INC3", 0.9)]
    response, spies = _run(incident_hits=hits, settings=settings)

    assert spies["incidents"].calls[0]["top_k"] == 2
    assert spies["problems"].calls[0]["top_k"] == 3
    assert [h.passed for h in response.retrieval.vector.incidents] == [True, True]


# --- layer 3: LLM post-filter ---------------------------------------------------
def test_postfilter_keeps_and_drops_with_reasons() -> None:
    verdicts = (
        '[{"number": "INC0000001", "relevant": true, "reason": "mesma causa"},'
        ' {"number": "INC0000002", "relevant": false, "reason": "só compartilha palavras"},'
        ' {"number": "PRB0004101", "relevant": true, "reason": "causa raiz conhecida"}]'
    )
    hits = [_inc_hit("INC0000001", 0.9), _inc_hit("INC0000002", 0.85)]
    response, _ = _run(ScriptedLLM(verdicts=verdicts), incident_hits=hits)

    layer = response.retrieval.postfilter
    assert layer.status == "ok"
    kept = {v.number: (v.kept, v.reason) for v in layer.verdicts}
    assert kept == {
        "INC0000001": (True, "mesma causa"),
        "INC0000002": (False, "só compartilha palavras"),
        "PRB0004101": (True, "causa raiz conhecida"),
    }
    assert response.referenced_incidents == ["INC0000001"]
    assert response.referenced_problems == ["PRB0004101"]
    assert [p.number for p in response.problems if p.survived_postfilter] == ["PRB0004101"]


def test_postfilter_failure_returns_the_original_list_instead_of_an_error() -> None:
    llm = ScriptedLLM(postfilter_error=TimeoutError("provider timeout"))
    hits = [_inc_hit("INC0000001", 0.9), _inc_hit("INC0000002", 0.85)]
    response, _ = _run(llm, incident_hits=hits)

    layer = response.retrieval.postfilter
    assert layer.status == "fallback"
    assert layer.fallback_reason
    assert all(v.kept for v in layer.verdicts)
    assert response.referenced_incidents == ["INC0000001", "INC0000002"]
    assert response.suggestion is not None
    step = next(s for s in response.steps if s.id == "recuperar")
    assert step.status == "degradada"


def test_postfilter_unparseable_answer_also_falls_back() -> None:
    response, _ = _run(ScriptedLLM(verdicts="não sei responder"))
    assert response.retrieval.postfilter.status == "fallback"
    assert response.referenced_incidents == ["INC0000001"]


# --- context, decision, suggestion ------------------------------------------------
def test_improcedente_generates_no_suggestion_and_publishes_nothing() -> None:
    response, spies = _run(ScriptedLLM(classification="IMPROCEDENTE"))

    assert response.classification is Classification.IMPROCEDENTE
    assert response.decision.generates_suggestion is False
    assert response.suggestion is None
    assert "sugerir" not in spies["llm"].calls
    steps = {s.id: s.status for s in response.steps}
    assert steps["sugerir"] == "pulada"
    assert steps["publicar"] == "pulada"
    assert response.publication.published is False
    assert spies["notes"].list("INC0099999") == []


def test_procedente_without_context_does_not_propose() -> None:
    response, spies = _run(incident_hits=[_inc_hit("INC0000001", 0.4)], problem_hits=[])

    assert response.classification is Classification.PROCEDENTE
    assert response.context_ids == []
    assert response.suggestion is None
    assert response.decision.generates_suggestion is False
    assert "sugerir" not in spies["llm"].calls


def test_context_holds_surviving_incidents_and_problems() -> None:
    response, _ = _run()
    assert response.context_ids == ["INC0000001", "PRB0004101"]
    context = next(s for s in response.steps if s.id == "contexto")
    assert "INC0000001" in context.decision and "PRB0004101" in context.decision


def test_citation_outside_the_retrieved_context_is_removed_and_flagged() -> None:
    llm = ScriptedLLM(
        suggestion=(
            "O pool saturou [PRB0004101].\n\n"
            "1. **Aumentar workers** [INC0000001] [INC0012345].\n\n"
            "2. **Revisar o DICT** [INC0000001, INC0077777]. Ver também INC0088888."
        )
    )
    response, _ = _run(llm)

    assert response.suggestion is not None
    assert "INC0012345" not in response.suggestion
    assert "INC0077777" not in response.suggestion
    assert "[INC0000001]" in response.suggestion
    assert "[PRB0004101]" in response.suggestion
    flags = {f.id: f.action for f in response.citations.flagged}
    assert flags == {
        "INC0012345": "removida",
        "INC0077777": "removida",
        "INC0088888": "sinalizada",
    }
    assert response.citations.cited == ["PRB0004101", "INC0000001"]
    step = next(s for s in response.steps if s.id == "sugerir")
    assert "fora do contexto" in step.decision


# --- publication -------------------------------------------------------------------
def test_suggestion_is_published_as_a_work_note_on_the_incident() -> None:
    response, spies = _run()

    assert response.publication.published is True
    (note,) = spies["notes"].list("INC0099999")
    assert note.text == response.suggestion
    assert note.sources == ["INC0000001", "PRB0004101"]
    assert note.author == "Aurora"
    assert response.publication.note == note


def test_without_an_incident_number_there_is_nowhere_to_publish() -> None:
    request = SuggestRequest(short_description="Pix sem comprovante", description="Detalhes.")
    response, spies = _run(request=request)
    assert response.suggestion is not None
    assert response.publication.published is False
    publish = next(s for s in response.steps if s.id == "publicar")
    assert publish.status == "pulada"
