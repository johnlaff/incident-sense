"""Audit of 21/10/2026: model replies that are off-format never flip the verdict,
and the published note only claims the sources the answer cites."""

from __future__ import annotations

from incident_sense.data.work_notes import WorkNotesStore
from incident_sense.models.suggest import Classification
from test_incident_pipeline import ScriptedLLM, _inc_hit, _run


class _FreeTextClassifier(ScriptedLLM):
    """Answers the procedência question in prose instead of JSON."""

    def __init__(self, reply: str, **kw: object) -> None:
        super().__init__(**kw)  # type: ignore[arg-type]
        self.reply = reply

    def complete(self, system: str, user: str, **kw: object) -> str:
        if "INCIDENTE de verdade" in system:
            self.calls.append("decidir")
            return self.reply
        return super().complete(system, user, **kw)  # type: ignore[arg-type]


def test_lowercase_classification_is_read() -> None:
    """P1-8: "Procedente" fails the enum today and falls back."""
    llm = _FreeTextClassifier('{"classification": "Procedente", "justification": "erro"}')
    response, _ = _run(llm)
    assert response.classification is Classification.PROCEDENTE
    assert "inválida" not in response.decision.justification


def test_unreadable_classification_never_becomes_improcedente() -> None:
    """P1-8: with no context, a prose answer used to read as a customer request."""
    llm = _FreeTextClassifier("Classificação: procedente, é uma falha real.")
    response, _ = _run(llm, incident_hits=[_inc_hit("INC0000001", 0.4)], problem_hits=[])
    assert response.classification is Classification.PROCEDENTE
    assert response.suggestion is None
    assert "formato esperado" in response.decision.justification


def test_relevant_false_as_a_string_drops_the_case() -> None:
    """P1-9: bool("false") is True."""
    verdicts = '[{"number": "INC0000001", "relevant": "false", "reason": "não tem relação"}]'
    response, _ = _run(ScriptedLLM(verdicts=verdicts), problem_hits=[])
    assert response.context_ids == []


def test_empty_suggestion_is_no_suggestion_and_publishes_nothing() -> None:
    """P1-10."""
    response, spies = _run(ScriptedLLM(suggestion="   "))
    assert response.suggestion is None
    assert response.publication.published is False
    assert spies["notes"].list("INC0099999") == []
    step = next(s for s in response.steps if s.id == "sugerir")
    assert step.status == "degradada"


def test_note_sources_are_only_the_cited_ones() -> None:
    """P1-11: the context had two cases, the answer cites one."""
    response, spies = _run(ScriptedLLM(suggestion="Ajuste o timeout do DICT [INC0000001]."))
    (note,) = spies["notes"].list("INC0099999")
    assert note.sources == ["INC0000001"]


def test_answer_without_any_valid_citation_is_not_published() -> None:
    """P1-11: no source left, so nothing to stand on."""
    response, spies = _run(ScriptedLLM(suggestion="Reinicie o serviço [INC0099998]."))
    assert response.citations.cited == []
    assert response.publication.published is False
    assert spies["notes"].list("INC0099999") == []


def test_same_text_twice_is_one_note() -> None:
    """P2-13: every Analisar used to append the same note again."""
    store = WorkNotesStore()
    a = store.publish("INC1", "Texto", sources=["INC2"])
    b = store.publish("INC1", "Texto", sources=["INC2"])
    assert a.id == b.id
    assert len(store.list("INC1")) == 1


def test_notes_are_scoped_to_the_visitor() -> None:
    """E2E P1: one visitor's AI note does not show up for the next student."""
    store = WorkNotesStore()
    store.publish("INC1", "Texto", sources=["INC2"], client_id="ana")
    assert store.list("INC1", client_id="bia") == []
    assert len(store.list("INC1", client_id="ana")) == 1


def test_incident_detail_shows_only_this_visitors_notes(client) -> None:  # type: ignore[no-untyped-def]
    from incident_sense.api.incidents import get_work_notes

    store = WorkNotesStore()
    store.publish("INC0052233", "Nota da IA", sources=["INC0052219"], client_id="ana")
    client.app.dependency_overrides[get_work_notes] = lambda: store
    mine = client.get("/api/incidents/INC0052233", headers={"X-Client-Id": "ana"}).json()
    other = client.get("/api/incidents/INC0052233", headers={"X-Client-Id": "bia"}).json()
    assert len(mine["published_notes"]) == 1
    assert other["published_notes"] == []


def test_lowercase_number_opens_the_incident(client) -> None:  # type: ignore[no-untyped-def]
    """E2E P2: inc0052233 opens INC0052233."""
    r = client.get("/api/incidents/inc0052233")
    assert r.status_code == 200
    assert r.json()["number"] == "INC0052233"


def test_lowercase_change_and_problem_numbers_open(client) -> None:  # type: ignore[no-untyped-def]
    assert client.get("/api/changes/chg0031001").status_code == 200
    assert client.get("/api/problems/prb0004105").status_code == 200
