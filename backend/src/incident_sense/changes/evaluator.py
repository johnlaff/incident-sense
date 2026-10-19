"""LLM-as-judge for Changes, following the published design step by step.

1. Scope: only Normal changes of Banco Meridiano in state New are evaluated;
   anything else is "not evaluated", never zero.
2. Content lock: a field whose text did not change since its last evaluation
   (same rubric version and model) reuses the stored score, with no model call.
3. One judge prompt per field, all in parallel, so a good field cannot
   compensate an empty one and latency tends to the slowest field, not the sum.
4. Weighted average over the rubric weights.
5. Eligibility lock: the semantic analysis (coherence across fields and backout
   plan versus registered tasks) runs only at or above the threshold.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Protocol

from pydantic import BaseModel, Field, ValidationError

from incident_sense.models.change import (
    EVALUATED_FIELDS,
    BackoutAdherence,
    Change,
    EvaluationResponse,
    FieldScore,
    Rubric,
    RubricField,
    ScopeVerdict,
    SemanticAnalysis,
)
from incident_sense.providers import extract_json


class JudgeLLM(Protocol):
    """The chat interface the judge needs (same shape as the RAG LLMClient)."""

    def complete(
        self, system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 800
    ) -> str:
        """Return the assistant's reply to a system + user prompt."""
        ...


_FIELD_SYSTEM = (
    "Você é um avaliador de qualidade de requisições de mudança (Changes) de TI de um "
    "banco. Avalie SOMENTE o campo indicado, contra os critérios da grade. Não avalie "
    "a mudança em si (se é boa ideia), apenas se o texto do campo cumpre o que o campo "
    "deve dizer. Texto genérico, vazio, 'N/A' ou copiado de outro campo merece nota "
    "baixa. Responda apenas com JSON."
)

_SEMANTIC_SYSTEM = (
    "Você é um revisor sênior de mudanças de TI de um banco. Os campos desta Change já "
    "estão bem preenchidos um a um; sua tarefa é verificar se eles contam a MESMA "
    "história: objetivo, plano de implementação, plano de validação, benefícios e "
    "plano de retorno precisam ser coerentes entre si, e o plano de retorno precisa "
    "desfazer de fato o que a implementação altera (por exemplo: se a implementação "
    "muda estrutura de dados, reverter só a imagem do contêiner não basta). Compare "
    "também o plano de retorno com as tarefas cadastradas. Responda apenas com JSON."
)

SCOPE_TYPE = "Normal"
SCOPE_STATE = "New"
SCOPE_COMPANY = "Banco Meridiano"


def scope_of(change: Change) -> ScopeVerdict:
    """Decide whether this Change is evaluated at all."""
    reasons = []
    if change.type != SCOPE_TYPE:
        reasons.append(f"tipo {change.type} (só avaliamos Normal)")
    if change.state != SCOPE_STATE:
        reasons.append(f"estado {change.state} (só avaliamos Novo)")
    if change.company != SCOPE_COMPANY:
        reasons.append(f"empresa {change.company} (só avaliamos {SCOPE_COMPANY})")
    if reasons:
        return ScopeVerdict(in_scope=False, reason="Não avaliada: " + "; ".join(reasons) + ".")
    return ScopeVerdict(in_scope=True)


def content_hash(text: str) -> str:
    """Stable fingerprint of a field's text (whitespace-normalized)."""
    normalized = " ".join(text.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


class _FieldOut(BaseModel):
    score: float = Field(ge=0, le=10)
    diagnosis: str
    guidance: str = ""


class _SemanticOut(BaseModel):
    consistency_score: float = Field(ge=0, le=10)
    problems: list[str] = Field(default_factory=list)
    reasoning: str
    guidance: str
    backout_adherence: BackoutAdherence
    backout_adherence_percent: int = Field(ge=0, le=100)


class EvaluationCache:
    """The content lock: last verdict per (rubric, model, field, content)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._fields: dict[tuple[str, ...], _FieldOut] = {}
        self._semantic: dict[tuple[str, ...], _SemanticOut] = {}

    def get_field(self, key: tuple[str, ...]) -> _FieldOut | None:
        """Return the stored verdict for this field content, if any."""
        with self._lock:
            return self._fields.get(key)

    def put_field(self, key: tuple[str, ...], value: _FieldOut) -> None:
        """Store the verdict for this field content."""
        with self._lock:
            self._fields[key] = value

    def get_semantic(self, key: tuple[str, ...]) -> _SemanticOut | None:
        """Return the stored semantic analysis for these contents, if any."""
        with self._lock:
            return self._semantic.get(key)

    def put_semantic(self, key: tuple[str, ...], value: _SemanticOut) -> None:
        """Store the semantic analysis for these contents."""
        with self._lock:
            self._semantic[key] = value


def _field_prompt(change: Change, rubric_field: RubricField, text: str) -> str:
    criteria = "\n".join(f"- {c}" for c in rubric_field.criteria)
    return (
        f"CHANGE {change.number} no serviço {change.cmdb_ci} (risco {change.risk}).\n\n"
        f"CAMPO AVALIADO: {rubric_field.label}\n"
        f"CRITÉRIOS DA GRADE:\n{criteria}\n\n"
        f'TEXTO DO CAMPO:\n"""\n{text.strip() or "(vazio)"}\n"""\n\n'
        'Responda com JSON: {"score": <0 a 10, uma casa decimal>, '
        '"diagnosis": "<uma ou duas frases sobre o que o campo cumpre e o que falta>", '
        '"guidance": "<uma frase dizendo ao autor como melhorar; vazio se nota >= 9>"}'
    )


def _semantic_prompt(change: Change, values: dict[str, str], backout: str) -> str:
    tasks = "\n".join(f"- {t.number}: {t.short_description}" for t in change.tasks)
    return (
        f"CHANGE {change.number} no serviço {change.cmdb_ci}.\n\n"
        f"Descrição resumida: {values['short_description']}\n"
        f"Objetivo: {values['objective']}\n"
        f"Benefícios: {values['benefits']}\n"
        f"Pré-requisitos: {values['prerequisites']}\n"
        f"Plano de implementação:\n{values['implementation_plan']}\n"
        f"Plano de validação:\n{values['validation_plan']}\n"
        f"Justificativa dos testes: {values['test_justification']}\n"
        f"Plano de retorno:\n{backout}\n\n"
        f"TAREFAS CADASTRADAS:\n{tasks or '(nenhuma)'}\n\n"
        'Responda com JSON: {"consistency_score": <0 a 10>, '
        '"problems": ["<cada incoerência encontrada, uma frase>"], '
        '"reasoning": "<duas ou três frases com o raciocínio>", '
        '"guidance": "<o que o autor deve ajustar>", '
        '"backout_adherence": "ADERENTE" | "PARCIAL" | "NAO_ADERENTE", '
        '"backout_adherence_percent": <0 a 100, quanto do plano de retorno está '
        "coberto pelas tarefas cadastradas>}"
    )


# Output budgets leave room for Portuguese prose inside the JSON: a budget that
# only fits the happy path truncates the object mid-string on wordier models.
_FIELD_MAX_TOKENS = 1000
_SEMANTIC_MAX_TOKENS = 2000


def _judge_field(llm: JudgeLLM, prompt: str) -> _FieldOut:
    raw = llm.complete(_FIELD_SYSTEM, prompt, temperature=0.0, max_tokens=_FIELD_MAX_TOKENS)
    try:
        return _FieldOut.model_validate(extract_json(raw))
    except (ValueError, ValidationError):
        # One structural repair attempt, then an explicit "could not judge".
        raw = llm.complete(
            _FIELD_SYSTEM,
            prompt + "\n\nResponda SOMENTE o JSON.",
            temperature=0.0,
            max_tokens=_FIELD_MAX_TOKENS,
        )
        return _FieldOut.model_validate(extract_json(raw))


def _judge_semantic(llm: JudgeLLM, prompt: str) -> _SemanticOut:
    raw = llm.complete(_SEMANTIC_SYSTEM, prompt, temperature=0.0, max_tokens=_SEMANTIC_MAX_TOKENS)
    try:
        return _SemanticOut.model_validate(extract_json(raw))
    except (ValueError, ValidationError):
        raw = llm.complete(
            _SEMANTIC_SYSTEM,
            prompt + "\n\nResponda SOMENTE o JSON, com textos curtos.",
            temperature=0.0,
            max_tokens=_SEMANTIC_MAX_TOKENS,
        )
        return _SemanticOut.model_validate(extract_json(raw))


class ChangeEvaluator:
    """Runs the evaluation for one model; share one cache across requests."""

    def __init__(
        self,
        llm: JudgeLLM,
        *,
        model: str,
        rubric: Rubric,
        cache: EvaluationCache,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._llm = llm
        self._model = model
        self._rubric = rubric
        self._cache = cache
        self._clock = clock
        self._calls = 0
        self._calls_lock = threading.Lock()

    def _count(self) -> None:
        with self._calls_lock:
            self._calls += 1

    def evaluate(
        self,
        change: Change,
        *,
        overrides: dict[str, str] | None = None,
        backout_plan: str | None = None,
    ) -> EvaluationResponse:
        """Evaluate ``change`` (with any edited field values) end to end."""
        started = self._clock()
        rubric = self._rubric
        scope = scope_of(change)
        base = EvaluationResponse(
            number=change.number,
            rubric_version=rubric.version,
            scope=scope,
            threshold=rubric.eligibility_threshold,
            model=self._model,
            model_calls=0,
            duration_ms=0,
        )
        if not scope.in_scope:
            return base.model_copy(update={"duration_ms": self._elapsed(started)})

        edits = {k: v for k, v in (overrides or {}).items() if k in EVALUATED_FIELDS}
        values = {key: edits.get(key, str(getattr(change, key))) for key in EVALUATED_FIELDS}
        backout = backout_plan if backout_plan is not None else change.backout_plan

        def score(rubric_field: RubricField) -> FieldScore:
            text = values[rubric_field.key]
            digest = content_hash(text)
            key = (rubric.version, self._model, change.number, rubric_field.key, digest)
            cached = self._cache.get_field(key)
            if cached is None:
                self._count()
                verdict = _judge_field(self._llm, _field_prompt(change, rubric_field, text))
                self._cache.put_field(key, verdict)
            else:
                verdict = cached
            return FieldScore(
                key=rubric_field.key,
                label=rubric_field.label,
                weight=rubric_field.weight,
                score=round(verdict.score, 1),
                diagnosis=verdict.diagnosis,
                guidance=verdict.guidance,
                reused=cached is not None,
                content_hash=digest,
            )

        with ThreadPoolExecutor(max_workers=len(rubric.fields)) as pool:
            scores = list(pool.map(score, rubric.fields))

        overall = round(
            sum(s.score * s.weight for s in scores) / rubric.total_weight,
            2,
        )
        semantic: SemanticAnalysis | None = None
        skipped: str | None = None
        if overall >= rubric.eligibility_threshold:
            semantic = self._semantic(change, values, backout, scores)
        else:
            skipped = (
                f"Nota {overall:.1f} abaixo de {rubric.eligibility_threshold:.1f}: o problema "
                "ainda é campo vazio ou genérico, e apontar incoerência entre campos não "
                "ajuda o autor agora."
            )
        return base.model_copy(
            update={
                "fields": scores,
                "overall": overall,
                "semantic": semantic,
                "semantic_skipped_reason": skipped,
                "model_calls": self._calls,
                "duration_ms": self._elapsed(started),
            }
        )

    def _semantic(
        self, change: Change, values: dict[str, str], backout: str, scores: list[FieldScore]
    ) -> SemanticAnalysis:
        key = (
            self._rubric.version,
            self._model,
            change.number,
            "semantic",
            *(s.content_hash for s in scores),
            content_hash(backout),
        )
        cached = self._cache.get_semantic(key)
        if cached is None:
            self._count()
            prompt = _semantic_prompt(change, values, backout)
            verdict = _judge_semantic(self._llm, prompt)
            self._cache.put_semantic(key, verdict)
        else:
            verdict = cached
        return SemanticAnalysis(**verdict.model_dump(), reused=cached is not None)

    def _elapsed(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
