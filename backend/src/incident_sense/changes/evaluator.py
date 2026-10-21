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
import re
import threading
import time
import unicodedata
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Protocol

from pydantic import BaseModel, Field, ValidationError, field_validator

from incident_sense.models.change import (
    EVALUATED_FIELDS,
    BackoutAdherence,
    Change,
    Decision,
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
    'também o plano de retorno com as tarefas cadastradas. Em "problems" entram '
    "SOMENTE contradições reais: uma parte do pedido afirma ou faz algo que outra "
    "parte desmente, ou o retorno deixa de desfazer algo que a implementação altera. "
    "Sugestões de melhoria, detalhes que faltam e boas práticas não são contradições: "
    'vão em "guidance". Se não houver contradição real, "problems" fica vazio. '
    "Responda apenas com JSON."
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


def _grade(value: object) -> object:
    """Read a 0-10 grade the way models actually write it: "8,5", 85 (of 100)."""
    if isinstance(value, str):
        text = value.strip().replace(",", ".").rstrip("%").strip()
        try:
            value = float(text)
        except ValueError:
            return value
    if isinstance(value, int | float) and 10 < value <= 100:
        return value / 10
    return value


def _percent(value: object) -> object:
    if isinstance(value, str):
        text = value.strip().rstrip("%").replace(",", ".").strip()
        try:
            return round(float(text))
        except ValueError:
            return value
    if isinstance(value, float):
        return round(value)
    return value


def _plain(text: str) -> str:
    """One line of plain text: no markdown emphasis or code ticks."""
    return re.sub(r"\s+", " ", re.sub(r"\*\*|__|`", "", text)).strip()


def _adherence_word(value: object) -> object:
    """'NÃO_ADERENTE', 'Não aderente', 'parcial' -> the enum's spelling."""
    if not isinstance(value, str):
        return value
    bare = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[\s-]+", "_", bare.strip()).upper()


def adherence_for(percent: int) -> BackoutAdherence:
    """The label follows the number, so the two can never contradict."""
    if percent >= 80:
        return BackoutAdherence.ADERENTE
    if percent >= 50:
        return BackoutAdherence.PARCIAL
    return BackoutAdherence.NAO_ADERENTE


class _FieldOut(BaseModel):
    score: float = Field(ge=0, le=10)
    diagnosis: str
    guidance: str = ""

    _normalize_score = field_validator("score", mode="before")(_grade)


class _SemanticOut(BaseModel):
    consistency_score: float = Field(ge=0, le=10)
    problems: list[str] = Field(default_factory=list)
    reasoning: str = ""
    guidance: str = ""
    backout_adherence: BackoutAdherence
    backout_adherence_percent: int = Field(ge=0, le=100)

    _normalize_score = field_validator("consistency_score", mode="before")(_grade)
    _normalize_percent = field_validator("backout_adherence_percent", mode="before")(_percent)
    _normalize_word = field_validator("backout_adherence", mode="before")(_adherence_word)

    @field_validator("problems", mode="before")
    @classmethod
    def _clean_points(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        seen: dict[str, None] = {}
        for item in value:
            text = _plain(str(item))
            if text:
                seen.setdefault(text, None)
        return list(seen)

    def settled(self) -> _SemanticOut:
        """One decimal on the score, and the label read from the percent."""
        return self.model_copy(
            update={
                "consistency_score": round(self.consistency_score, 1),
                "backout_adherence": adherence_for(self.backout_adherence_percent),
                "reasoning": self.reasoning.strip(),
                "guidance": self.guidance.strip(),
            }
        )


def _fmt(n: float, places: int = 1) -> str:
    return f"{n:.{places}f}".replace(".", ",")


def decide(overall: float, threshold: float, semantic: SemanticAnalysis | None) -> Decision:
    """The rule, once. Every view reads this instead of re-deriving it."""
    avg = _fmt(overall, 2)
    cut = _fmt(threshold)
    if overall < threshold:
        return Decision(
            passes=False,
            reason_code="average_below",
            reason=f"A média ficou em {avg}, abaixo do mínimo de {cut}.",
        )
    if semantic is None:
        return Decision(
            passes=False,
            reason_code="semantic_missing",
            reason=(
                f"A média passou do mínimo ({avg}), mas a conferência das partes do "
                "pedido não voltou. Avalie de novo."
            ),
        )
    coh = _fmt(semantic.consistency_score)
    if semantic.consistency_score < threshold:
        return Decision(
            passes=False,
            reason_code="coherence_below",
            reason=(
                f"A média passou ({avg}), mas as partes do pedido não combinam: "
                f"coerência {coh}, abaixo de {cut}."
            ),
        )
    if semantic.backout_adherence == BackoutAdherence.NAO_ADERENTE:
        return Decision(
            passes=False,
            reason_code="backout_not_adherent",
            reason=(
                f"A média passou ({avg}), mas o plano de retorno não desfaz o que as tarefas fazem."
            ),
        )
    return Decision(
        passes=True,
        reason_code="passes",
        reason=f"Média {avg} e coerência {coh}, as duas a partir de {cut}.",
    )


_CACHE_MAX = 5000


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
            # Keyed per visitor now: keep it bounded, oldest first out.
            if len(self._fields) >= _CACHE_MAX:
                self._fields.pop(next(iter(self._fields)))
            self._fields[key] = value

    def get_semantic(self, key: tuple[str, ...]) -> _SemanticOut | None:
        """Return the stored semantic analysis for these contents, if any."""
        with self._lock:
            return self._semantic.get(key)

    def put_semantic(self, key: tuple[str, ...], value: _SemanticOut) -> None:
        """Store the semantic analysis for these contents."""
        with self._lock:
            # Keyed per visitor now: keep it bounded, oldest first out.
            if len(self._semantic) >= _CACHE_MAX:
                self._semantic.pop(next(iter(self._semantic)))
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
        '"problems": ["<cada contradição real entre as partes, uma frase; '
        'sugestões não entram aqui>"], '
        '"reasoning": "<duas ou três frases com o raciocínio>", '
        '"guidance": "<o que o autor deve ajustar, incluindo sugestões de melhoria>", '
        '"backout_adherence": "ADERENTE" | "PARCIAL" | "NAO_ADERENTE", '
        '"backout_adherence_percent": <0 a 100, quanto do que as tarefas cadastradas '
        "fazem o plano de retorno desfaz>}"
    )


# Output budgets leave room for Portuguese prose inside the JSON: a budget that
# only fits the happy path truncates the object mid-string on wordier models.
_FIELD_MAX_TOKENS = 1000
_SEMANTIC_MAX_TOKENS = 2000


def _judge_field(llm: JudgeLLM, prompt: str, count: Callable[[], None]) -> _FieldOut:
    count()
    raw = llm.complete(_FIELD_SYSTEM, prompt, temperature=0.0, max_tokens=_FIELD_MAX_TOKENS)
    try:
        return _FieldOut.model_validate(extract_json(raw))
    except (ValueError, ValidationError):
        # One structural repair attempt, then an explicit "could not judge".
        count()
        raw = llm.complete(
            _FIELD_SYSTEM,
            prompt + "\n\nResponda SOMENTE o JSON.",
            temperature=0.0,
            max_tokens=_FIELD_MAX_TOKENS,
        )
        return _FieldOut.model_validate(extract_json(raw))


def _judge_semantic(llm: JudgeLLM, prompt: str, count: Callable[[], None]) -> _SemanticOut:
    count()
    raw = llm.complete(_SEMANTIC_SYSTEM, prompt, temperature=0.0, max_tokens=_SEMANTIC_MAX_TOKENS)
    try:
        return _SemanticOut.model_validate(extract_json(raw))
    except (ValueError, ValidationError):
        count()
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
        client_id: str = "",
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
            # Per visitor: a fresh visitor never sees someone else's reading as
            # "reaproveitado"; the same visitor re-evaluating keeps the lock.
            key = (client_id, rubric.version, self._model, change.number, rubric_field.key, digest)
            cached = self._cache.get_field(key)
            if cached is None:
                verdict = _judge_field(
                    self._llm, _field_prompt(change, rubric_field, text), self._count
                )
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
            semantic = self._semantic(change, values, backout, scores, client_id)
            if semantic is None:
                skipped = (
                    "A IA não respondeu à conferência de coerência no formato esperado. "
                    "Avalie de novo."
                )
        else:
            lowest = min(scores, key=lambda s: s.score)
            vague = lowest.score < 5
            skipped = (
                # Two places, like the overall itself: 7.96 must not read "8.0 abaixo de 8.0".
                f"Nota {overall:.2f} abaixo de {rubric.eligibility_threshold:.1f}: "
                + (
                    "ainda há campo vazio ou vago, a começar por "
                    if vague
                    else "falta pouco; o campo que mais puxa a nota para baixo é "
                )
                + f"{lowest.label} ({lowest.score:.1f}). Procurar contradições entre as "
                "partes do pedido não ajuda o autor agora."
            )
        return base.model_copy(
            update={
                "fields": scores,
                "overall": overall,
                "semantic": semantic,
                "semantic_skipped_reason": skipped,
                "decision": decide(overall, rubric.eligibility_threshold, semantic),
                "model_calls": self._calls,
                "duration_ms": self._elapsed(started),
            }
        )

    def _semantic(
        self,
        change: Change,
        values: dict[str, str],
        backout: str,
        scores: list[FieldScore],
        client_id: str = "",
    ) -> SemanticAnalysis | None:
        key = (
            client_id,
            self._rubric.version,
            self._model,
            change.number,
            "semantic",
            *(s.content_hash for s in scores),
            content_hash(backout),
        )
        cached = self._cache.get_semantic(key)
        if cached is None:
            prompt = _semantic_prompt(change, values, backout)
            try:
                verdict = _judge_semantic(self._llm, prompt, self._count).settled()
            except (ValueError, ValidationError):
                # Only this part degrades; the field grades still stand.
                return None
            self._cache.put_semantic(key, verdict)
        else:
            verdict = cached
        return SemanticAnalysis(**verdict.model_dump(), reused=cached is not None)

    def _elapsed(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
