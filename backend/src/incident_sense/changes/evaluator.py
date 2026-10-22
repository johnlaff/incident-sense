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
import itertools
import re
import statistics
import threading
import time
import unicodedata
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Protocol

import openai
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

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
    "também o plano de retorno com as tarefas cadastradas.\n\n"
    'Cada item de "problems" tem um tipo:\n'
    '- "contradicao": DUAS partes afirmam fatos incompatíveis. Exemplo: a '
    "implementação migra o schema e os dados, mas o retorno só volta a imagem do "
    "contêiner; ou o objetivo fala em 30 segundos e os benefícios em 9 minutos.\n"
    '- "lacuna": algo que falta numa parte, sem que outra parte diga o contrário. '
    "Exemplo: o plano de validação não diz quem confirma o sucesso. Uma tarefa "
    "que falta (mesmo para um passo do retorno), um detalhe que falta ou um "
    'responsável que falta é SEMPRE "lacuna", nunca "contradicao", mesmo que '
    "cite duas partes.\n"
    '- "sugestao": uma proteção extra ou um detalhe que "também poderia" entrar. '
    "Exemplo: registrar um snapshot de backup antes do retorno, ou explicitar como "
    "o canário vira 50%.\n"
    'Em "campos", nomeie as partes envolvidas (objetivo, descrição resumida, '
    "benefícios, pré-requisitos, implementação, validação, testes, retorno, "
    'tarefas); uma "contradicao" sempre nomeia duas. Só "contradicao" reprova a '
    "mudança: na dúvida entre contradição e sugestão, é sugestão. Se não houver "
    'nada a apontar, responda "problems": [] (lista vazia). '
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


_NUMBER = re.compile(r"-?\d+(?:[.,]\d+)?")
# A short word before the number ("Nota: 9", "nota 8,5"), never a sentence.
_LABEL = re.compile(r"^[^\W\d_]{1,12}\s*:?\s*$")


def _first_number(text: str) -> float | None:
    """The leading number of "8,5", "9/10", "9.0 (bom)", "80%" or "Nota: 9"."""
    match = _NUMBER.search(text)
    if match is None:
        return None
    before = text.strip()[: text.strip().find(match.group(0))].strip()
    if before and not _LABEL.match(before):
        return None
    return float(match.group(0).replace(",", "."))


def _grade(value: object) -> object:
    """Read a 0-10 grade the way models write it: "8,5", "9/10", 85 (of 100).

    Only 11 to 100 is a 0-100 scale; 10.x is a 10 that overshot, not 1,0.
    """
    if isinstance(value, str):
        number = _first_number(value)
        if number is None:
            return value
        value = number
    if isinstance(value, bool) or not isinstance(value, int | float):
        return value
    if 10 < value < 11:
        return 10.0
    if 11 <= value <= 100:
        return value / 10
    return value


def _percent(value: object) -> object:
    """Read "80%", 80.4, 0.8 or 1.0 as a whole percent.

    One rule, by how the number is written: a decimal number in (0, 1] is a
    fraction (0.8 -> 80, 1.0 -> 100); an integer or anything with "%" is
    already a percent (1 -> 1, "1%" -> 1).
    """
    if isinstance(value, str):
        text = value.strip()
        number = _first_number(text)
        if number is None:
            return value
        if "%" in text or not re.search(r"[.,]", text):
            return round(number)
        value = number
    if isinstance(value, bool) or not isinstance(value, int | float):
        return value
    if isinstance(value, float) and 0 < value <= 1:
        value = value * 100
    return round(value)


def _text(value: object) -> object:
    """A missing text is an empty one."""
    return "" if value is None else value


def _points(value: object) -> object:
    """None is no point; one string is one point."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return value


_NONE_WORDS = re.compile(r"^(n ?a|none|nenhum|nenhuma|nada|vazio|sem|nao se aplica|nao ha)$")
_NOTHING_TO_SAY = re.compile(
    r"^(?:nada a (?:apontar|declarar|destacar|relatar|acrescentar)|tudo certo|tudo ok)\b"
)
# A denial: a negation whose object is the contradiction itself ("Não foram
# identificadas contradições", "Nenhuma inconsistência entre..."). Only
# auxiliary words may sit between the two, so "Nenhuma tarefa cobre..." is
# not one: its negation falls on "tarefa".
_DENIAL = re.compile(
    r"^(?:nao|nenhum\w*|sem|nada|inexist\w*)"
    r"(?:\s+(?:ha|houve|havia|existe\w*|foi|foram|se|eu|identifi\w*|encontr\w*|detect\w*|"
    r"aponta\w*|observ\w*|verifi\w*|constat\w*|nota\w*|vejo|vi|nenhum\w*|qualquer|"
    r"outr\w*|um|uma|de|real|reais|evidente\w*|aparente\w*))*"
    r"\s+(?:contradic|inconsistenc|divergenc|conflit|incoerenc|problema|ponto|ressalva|"
    r"discrepanc|incompatib)"
)

# Something missing: a task, a detail or an owner. It is a gap ("lacuna")
# whatever the model typed it, even naming two parts: a contradiction needs two
# parts that state incompatible facts (calibração ao vivo, run #5). A missing
# undo ("o retorno não desfaz a migração") is not here: that is the definition
# of a contradiction between implementation and back-out.
_MISSING = re.compile(
    r"\b(?:nao (?:tem|tem|ha|possui\w*|existe\w*)|nenhum\w*|sem|falta\w*)\b"
    r"(?:\s+\w+){0,3}?\s+(?:tarefas?|responsave\w*|dono|detalh\w*)\b"
    r"|\btarefas?\b(?:\s+\w+){0,4}?\s+nao (?:esta|estao|foi|foram) cadastrad"
    r"|\bnao (?:diz|define|indica|informa|nomeia) (?:o |a |um |uma )?(?:quem|responsave\w*|dono)"
    r"|\bnao (?:detalha|explicita|especifica)\b"
)


# The parts of a Change a contradiction can be between, by the words that name
# them. A contradiction is between two parts; one part alone is a remark.
_PARTS: dict[str, re.Pattern[str]] = {
    part: re.compile(pattern)
    for part, pattern in {
        "objetivo": r"\bobjetivo",
        "descricao": r"\bdescricao resumida|\btitulo\b",
        "beneficios": r"\bbeneficio",
        "prerequisitos": r"\bpre ?requisito",
        "implementacao": (
            r"\bimplementa\w*|\bimplanta\w*|\bplano\b(?! de (?:retorno|validacao|testes?))"
        ),
        "validacao": r"\bvalidac\w*",
        "testes": r"\btestes?\b|\bjustificativa",
        "retorno": r"\bretorno|\brollback|\bbackout|\breversao\b",
        "tarefas": r"\btarefas?\b",
    }.items()
}


def _bare(text: str) -> str:
    """Lowercase ASCII words only, for matching."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", ascii_text).split())


def _says_nothing(text: str) -> bool:
    """A filler item ("Nenhuma contradição encontrada.", "N/A", "-")."""
    bare = _bare(text)
    return (
        not bare
        or bool(_NONE_WORDS.match(bare))
        or bool(_NOTHING_TO_SAY.match(bare))
        or bool(_DENIAL.match(bare))
    )


def parts_named(text: str) -> set[str]:
    """The Change parts a text names ("o retorno e as tarefas" -> both)."""
    bare = _bare(text)
    return {part for part, pattern in _PARTS.items() if pattern.search(bare)}


_KINDS = {"contradicao": "contradicao", "lacuna": "lacuna", "sugestao": "sugestao"}


def _kind(value: object) -> str | None:
    """'Contradição', 'SUGESTAO' -> the kind; anything else -> None (untyped)."""
    word = _bare(str(value or "")).replace(" ", "")
    return _KINDS.get(word)


def _read_point(item: object) -> tuple[str, str | None, set[str]]:
    """One item as (plain text, kind or None, the Change parts it names)."""
    named: set[str] = set()
    kind: str | None = None
    if isinstance(item, dict):
        said = item.get("descricao") or item.get("description") or item.get("texto")
        text = _plain(str(said or ""))
        kind = _kind(item.get("tipo") or item.get("type"))
        fields = item.get("campos") or item.get("fields") or []
        for field in [fields] if isinstance(fields, str) else list(fields):
            named |= parts_named(str(field))
    else:
        text = _plain("" if item is None else str(item))
    return text, kind, named | parts_named(text)


def classify_point(item: object, *, aligned: bool = False) -> tuple[str, str]:
    """Sort one item of "problems" into ("contradiction" | "attention" | "none", text).

    The model types each item: ``{"tipo": "contradicao" | "lacuna" |
    "sugestao", "campos": [...], "descricao": "..."}``. Only a contradicao
    that names two distinct parts of the Change blocks it; a gap (lacuna) or a
    suggestion (sugestao) is a point of attention for the author. An item that
    denies a contradiction, or is empty, is nothing.

    An untyped item (an older plain string) goes through the same two-part
    rule, except when the judge itself found the Change aligned (coherence and
    back-out both at the cut): then only a typed contradicao can block, and
    the rest is attention. A rule on structure, not on phrasings, is what
    stops a polite or advisory item from failing a Change (logica-3 P1-B,
    logica-4 P2-5, logica-5 P1-2, e2e-5 P0-1).
    """
    text, kind, named = _read_point(item)
    if _says_nothing(text):
        return "none", ""
    if kind in ("lacuna", "sugestao") or _MISSING.search(_bare(text)):
        return "attention", text
    if kind is None and aligned:
        return "attention", text
    return ("contradiction" if len(named) >= 2 else "attention"), text


def _plain(text: str) -> str:
    """One line of plain text: no markdown emphasis or code ticks."""
    return re.sub(r"\s+", " ", re.sub(r"\*\*|__|`", "", text)).strip()


def _adherence_word(value: object) -> object:
    """'NÃO_ADERENTE', 'Não aderente', 'parcial' -> the enum's spelling.

    The label is informative only: the percent decides it (see ``settled``),
    so a word the enum does not know reads as no word instead of failing.
    """
    if not isinstance(value, str):
        return None
    bare = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    word = re.sub(r"[\s-]+", "_", bare.strip()).upper()
    return word if word in BackoutAdherence.__members__ else None


ADHERENT_FROM = 80
PARTIAL_FROM = 50
# The judge calls the Change aligned from this coherence (and an adherent
# back-out plan): an untyped item cannot block it then.
ALIGNED_FROM = 8.0


def adherence_for(percent: int) -> BackoutAdherence:
    """The label follows the number, so the two can never contradict."""
    if percent >= ADHERENT_FROM:
        return BackoutAdherence.ADERENTE
    if percent >= PARTIAL_FROM:
        return BackoutAdherence.PARCIAL
    return BackoutAdherence.NAO_ADERENTE


class _FieldOut(BaseModel):
    score: float = Field(ge=0, le=10)
    diagnosis: str = ""
    guidance: str = ""

    _normalize_score = field_validator("score", mode="before")(_grade)
    _normalize_text = field_validator("diagnosis", "guidance", mode="before")(_text)


class _SemanticOut(BaseModel):
    consistency_score: float = Field(ge=0, le=10)
    problems: list[str] = Field(default_factory=list)
    attention: list[str] = Field(default_factory=list)
    # The Change parts each kept problem names, in the same order: the three
    # runs agree on a contradiction by its pair of parts.
    problem_parts: list[list[str]] = Field(default_factory=list)
    reasoning: str = ""
    guidance: str = ""
    backout_adherence: BackoutAdherence | None = None
    backout_adherence_percent: int = Field(ge=0, le=100)

    _normalize_score = field_validator("consistency_score", mode="before")(_grade)
    _normalize_percent = field_validator("backout_adherence_percent", mode="before")(_percent)
    _normalize_word = field_validator("backout_adherence", mode="before")(_adherence_word)
    _normalize_text = field_validator("reasoning", "guidance", mode="before")(_text)

    @model_validator(mode="before")
    @classmethod
    def _sort_points(cls, data: object) -> object:
        """Real contradictions in "problems"; gaps and suggestions in "attention"."""
        if not isinstance(data, dict):
            return data
        items = _points(data.get("problems"))
        if not isinstance(items, list):
            return data
        score = _first_number(str(data.get("consistency_score", "")))
        percent = _first_number(str(data.get("backout_adherence_percent", "")))
        aligned = (
            score is not None
            and percent is not None
            and round(score, 1) >= ALIGNED_FROM
            and percent >= ADHERENT_FROM
        )
        kept: dict[str, list[str]] = {}
        attention: dict[str, None] = {}
        extra = _points(data.get("attention"))
        for item in [*items, *(extra if isinstance(extra, list) else [])]:
            kind, text = classify_point(item, aligned=aligned)
            if kind == "contradiction":
                kept.setdefault(text, sorted(_read_point(item)[2]))
            elif kind == "attention":
                attention.setdefault(text, None)
        return {
            **data,
            "problems": list(kept),
            "problem_parts": list(kept.values()),
            "attention": list(attention),
        }

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


# The coherence judgement runs this many times in parallel (calibração ao vivo).
SEMANTIC_RUNS = 3


def _pairs(parts: list[str]) -> set[tuple[str, str]]:
    return set(itertools.combinations(sorted(set(parts)), 2))


def aggregate_semantic(runs: list[_SemanticOut]) -> _SemanticOut:
    """One reading from up to three runs of the coherence judgement.

    Coherence and back-out percent are the medians. A contradiction counts
    only when at least two runs (both, with two; the one, with one) found a
    contradiction on the same pair of parts; any other contradiction becomes a
    point of attention. Text, reasoning and guidance come from the run whose
    coherence is the median, so the card reads as one judgement.
    """
    if len(runs) == 1:
        return runs[0]
    score = round(statistics.median(r.consistency_score for r in runs), 1)
    percent = int(round(statistics.median(r.backout_adherence_percent for r in runs)))
    need = 2
    seen: dict[tuple[str, str], int] = {}
    for run in runs:
        for pair in set().union(*(_pairs(p) for p in run.problem_parts)):
            seen[pair] = seen.get(pair, 0) + 1
    agreed = {pair for pair, n in seen.items() if n >= need}
    rep = min(runs, key=lambda r: abs(r.consistency_score - score))
    ordered = [rep, *(r for r in runs if r is not rep)]
    problems: dict[str, list[str]] = {}
    covered: set[tuple[str, str]] = set()
    demoted: list[str] = []
    for run in ordered:
        for text, parts in zip(run.problems, run.problem_parts, strict=False):
            mine = _pairs(parts) & agreed
            if mine and not mine <= covered:
                problems.setdefault(text, parts)
                covered |= mine
            elif not mine and run is rep:
                demoted.append(text)
    attention = list(dict.fromkeys([*rep.attention, *demoted]))
    return rep.model_copy(
        update={
            "consistency_score": score,
            "backout_adherence_percent": percent,
            "backout_adherence": adherence_for(percent),
            "problems": list(problems),
            "problem_parts": list(problems.values()),
            "attention": attention,
        }
    )


def _fmt(n: float, places: int = 1) -> str:
    return f"{n:.{places}f}".replace(".", ",")


def join_pt(items: list[str]) -> str:
    """List names as the screen does: "A, B e C"."""
    if len(items) <= 1:
        return items[0] if items else ""
    return f"{', '.join(items[:-1])} e {items[-1]}"


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# Why the coherence check did not come back, in the words every view shows.
SEMANTIC_ERRORS = {
    "timeout": "a IA demorou demais para responder",
    "quota": "a IA está sem cota agora",
    "format": "a IA não respondeu no formato esperado",
}


def semantic_error_kind(exc: BaseException) -> str:
    """Timeout, quota or a reply off the format: each one is said plainly."""
    if isinstance(exc, openai.APITimeoutError):
        return "timeout"
    if isinstance(exc, openai.APIStatusError) and exc.status_code in (402, 429):
        return "quota"
    return "format"


def decide(
    overall: float,
    threshold: float,
    semantic: SemanticAnalysis | None,
    missing: list[str] | None = None,
    *,
    best: float | None = None,
    semantic_error: str | None = None,
) -> Decision:
    """The rule, once. Every view reads this instead of re-deriving it.

    Order: a field the AI could not read (unless even a 10 there could not
    lift the average to the cut: then the average decides), the average, the
    coherence check that did not come back, then gate 2. Gate 2 names every
    part that fails (coherence, contradictions, back-out plan); the reason
    code is the first of them and ``failed`` lists them all.
    """
    avg = _fmt(overall, 2)
    cut = _fmt(threshold)
    if missing:
        names = join_pt(missing)
        if best is not None and best < threshold:
            return Decision(
                passes=False,
                reason_code="average_below",
                failed=["average_below"],
                reason=(
                    f"Mesmo com nota 10 em {names}, a média chegaria no máximo a "
                    f"{_fmt(best, 2)}, abaixo do mínimo de {cut}."
                ),
            )
        return Decision(
            passes=False,
            reason_code="field_missing",
            failed=["field_missing"],
            reason=(
                f"A IA não conseguiu avaliar {'o campo' if len(missing) == 1 else 'os campos'} "
                f"{names}. Sem essa nota não há veredito: avalie de novo."
            ),
        )
    if overall < threshold:
        return Decision(
            passes=False,
            reason_code="average_below",
            failed=["average_below"],
            reason=f"A média ficou em {avg}, abaixo do mínimo de {cut}.",
        )
    if semantic is None:
        why = SEMANTIC_ERRORS.get(semantic_error or "format", SEMANTIC_ERRORS["format"])
        again = "Tente de novo mais tarde." if semantic_error == "quota" else "Avalie de novo."
        return Decision(
            passes=False,
            reason_code="semantic_missing",
            failed=["semantic_missing"],
            reason=(
                f"A média passou do mínimo ({avg}), mas a conferência das partes do "
                f"pedido não voltou: {why}. {again}"
            ),
        )
    coh = _fmt(semantic.consistency_score)
    failed: list[str] = []
    parts: list[str] = []
    if semantic.consistency_score < threshold:
        failed.append("coherence_below")
        parts.append(f"as partes do pedido não combinam: coerência {coh}, abaixo de {cut}")
    if semantic.problems:
        failed.append("contradictions")
        count = _plural(len(semantic.problems), "contradição", "contradições")
        parts.append(f"a IA encontrou {count} entre as partes do pedido")
    if semantic.backout_adherence == BackoutAdherence.NAO_ADERENTE:
        failed.append("backout_not_adherent")
        pct = semantic.backout_adherence_percent
        parts.append(
            f"o plano de retorno desfaz só {pct}% do que as tarefas fazem "
            f"(abaixo de {PARTIAL_FROM}% a mudança não segue)"
        )
    if failed:
        lead = (
            f"A média passou ({avg}), mas "
            if "coherence_below" in failed
            else f"A média ({avg}) e a coerência ({coh}) passaram, mas "
        )
        joined = parts[0] if len(parts) == 1 else "; ".join(parts[:-1]) + "; e " + parts[-1]
        return Decision(
            passes=False, reason_code=failed[0], failed=failed, reason=f"{lead}{joined}."
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
        '"problems": [{"tipo": "contradicao" | "lacuna" | "sugestao", '
        '"campos": ["<parte>", "<outra parte>"], "descricao": "<uma frase>"}] '
        "(sem nada a apontar, []), "
        '"reasoning": "<duas ou três frases com o raciocínio>", '
        '"guidance": "<o que o autor deve ajustar, incluindo sugestões de melhoria>", '
        '"backout_adherence_percent": <0 a 100, quanto do que as tarefas cadastradas '
        "fazem o plano de retorno desfaz>}\n"
        f"O percentual decide o rótulo: a partir de {ADHERENT_FROM} é aderente, de "
        f"{PARTIAL_FROM} a {ADHERENT_FROM - 1} é parcial e abaixo de {PARTIAL_FROM} não é "
        "aderente (a mudança não segue)."
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
        fresh: bool = False,
    ) -> EvaluationResponse:
        """Evaluate ``change`` (with any edited field values) end to end.

        ``fresh`` skips the content lock (every part goes back to the model) and
        stores the new reading, so a practice run never freezes the live demo.
        """
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

        errors: list[Exception] = []

        def score(rubric_field: RubricField) -> FieldScore:
            text = values[rubric_field.key]
            digest = content_hash(text)
            # Per visitor: a fresh visitor never sees someone else's reading as
            # "reaproveitado"; the same visitor re-evaluating keeps the lock.
            key = (client_id, rubric.version, self._model, change.number, rubric_field.key, digest)
            cached = None if fresh else self._cache.get_field(key)
            if cached is None:
                try:
                    verdict = _judge_field(
                        self._llm, _field_prompt(change, rubric_field, text), self._count
                    )
                except Exception as exc:  # noqa: BLE001 - only this field degrades.
                    errors.append(exc)
                    return FieldScore(
                        key=rubric_field.key,
                        label=rubric_field.label,
                        weight=rubric_field.weight,
                        score=None,
                        failed=True,
                        diagnosis="A IA não conseguiu avaliar este campo. Avalie de novo.",
                        reused=False,
                        content_hash=digest,
                    )
                self._cache.put_field(key, verdict)
            else:
                verdict = cached
            return FieldScore(
                key=rubric_field.key,
                label=rubric_field.label,
                weight=rubric_field.weight,
                score=min(round(verdict.score, 1), 10.0),
                diagnosis=verdict.diagnosis,
                guidance=verdict.guidance,
                reused=cached is not None,
                content_hash=digest,
            )

        with ThreadPoolExecutor(max_workers=len(rubric.fields)) as pool:
            scores = list(pool.map(score, rubric.fields))

        judged = [s for s in scores if s.score is not None]
        if not judged:
            # Nothing to show: the provider (or every reply) failed. Let the API
            # map the first error (quota, timeout) to its clean message.
            raise errors[0]
        missing = [s.label for s in scores if s.score is None]
        # With a field missing the average is over the judged ones only, and
        # the decision says so; it never passes.
        overall = round(
            sum(s.score * s.weight for s in judged if s.score is not None)
            / sum(s.weight for s in judged),
            2,
        )
        # The highest average still within reach: a 10 in every missing field.
        best = round(
            (
                sum(s.score * s.weight for s in judged if s.score is not None)
                + 10 * sum(s.weight for s in scores if s.score is None)
            )
            / sum(s.weight for s in scores),
            2,
        )
        semantic: SemanticAnalysis | None = None
        semantic_error: str | None = None
        skipped: str | None = None
        if missing:
            reachable = best >= rubric.eligibility_threshold
            # Unreachable: the answer is already "Não segue"; asking to
            # evaluate again would contradict it (logica-4 P2-9).
            skipped = (
                "A conferência de coerência espera todas as notas: falta "
                + join_pt(missing)
                + ". Avalie de novo."
                if reachable
                else "Não conferida: nem com nota 10 em "
                + join_pt(missing)
                + " a média chegaria ao mínimo."
            )
        elif overall >= rubric.eligibility_threshold:
            semantic, semantic_error = self._semantic(
                change, values, backout, scores, client_id, fresh
            )
            if semantic is None:
                kind = semantic_error or "format"
                again = "Tente de novo mais tarde." if kind == "quota" else "Avalie de novo."
                skipped = f"Não conferida: {SEMANTIC_ERRORS[kind]}. {again}"
        else:
            lowest = min(judged, key=lambda s: s.score or 0.0)
            vague = (lowest.score or 0.0) < 5
            skipped = (
                # Two places, like the overall itself: 7.96 must not read "8.0 abaixo de 8.0".
                f"Nota {overall:.2f} abaixo de {rubric.eligibility_threshold:.1f}: "
                + (
                    "ainda há campo vazio ou vago, a começar por "
                    if vague
                    else "falta pouco; o campo que mais puxa a nota para baixo é "
                )
                + f"{lowest.label} ({lowest.score or 0.0:.1f}). Procurar contradições entre as "
                "partes do pedido não ajuda o autor agora."
            )
        return base.model_copy(
            update={
                "fields": scores,
                "overall": overall,
                "semantic": semantic,
                "semantic_skipped_reason": skipped,
                "decision": decide(
                    overall,
                    rubric.eligibility_threshold,
                    semantic,
                    missing,
                    best=best if missing else None,
                    semantic_error=semantic_error,
                ),
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
        fresh: bool = False,
    ) -> tuple[SemanticAnalysis | None, str | None]:
        """The coherence check, or None and why it did not come back."""
        key = (
            client_id,
            self._rubric.version,
            self._model,
            change.number,
            "semantic",
            *(s.content_hash for s in scores),
            content_hash(backout),
        )
        cached = None if fresh else self._cache.get_semantic(key)
        if cached is None:
            prompt = _semantic_prompt(change, values, backout)

            def once(_: int) -> _SemanticOut | BaseException:
                try:
                    return _judge_semantic(self._llm, prompt, self._count).settled()
                except Exception as exc:  # noqa: BLE001 - one run degrades, not all.
                    return exc

            # Three runs at once, so the wait is one call's: one judgement at
            # temperature 0 still flips between runs (calibração ao vivo).
            with ThreadPoolExecutor(max_workers=SEMANTIC_RUNS) as pool:
                outcomes = list(pool.map(once, range(SEMANTIC_RUNS)))
            runs = [o for o in outcomes if isinstance(o, _SemanticOut)]
            if not runs:
                # The field grades still stand; the decision says why and what to do.
                first = next(o for o in outcomes if isinstance(o, BaseException))
                return None, semantic_error_kind(first)
            verdict = aggregate_semantic(runs)
            self._cache.put_semantic(key, verdict)
        else:
            verdict = cached
        return (
            SemanticAnalysis(
                **verdict.model_dump(exclude={"problem_parts"}), reused=cached is not None
            ),
            None,
        )

    def _elapsed(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
