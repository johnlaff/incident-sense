"""The incident resolution-suggestion pipeline, as in João's article.

Seven steps, one small function each (mock-friendly, independently testable):

    1. load the incident            (from the incident base, the ITSM stand-in)
    2. AI summary                   (the summary, never the raw text, is the query)
    3. embed summary + categoria, subcategoria, empresa
    4. three-layer retrieval        (semantic tags -> vector -> LLM post-filter)
    5. context of similar records   then the gate: is the incident procedente?
    6. suggestion with sources      (cited ids validated against the context)
    7. publication on the incident  (a work note)

The response reports every step and every layer with what it decided, so the
reasoning is visible instead of hidden behind one answer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from pydantic import BaseModel, ValidationError
from qdrant_client import models as qm

from incident_sense.config import Settings
from incident_sense.logging import get_logger
from incident_sense.models import (
    CitationCheck,
    CitationFlag,
    Classification,
    PipelineStep,
    PostFilterLayer,
    PostFilterVerdict,
    ProcedenciaDecision,
    Publication,
    RetrievalTrace,
    RetrievedCandidate,
    RetrievedProblem,
    StepStatus,
    SuggestRequest,
    SuggestResponse,
    TagLayer,
    VectorHit,
    VectorLayer,
)
from incident_sense.providers import extract_json
from incident_sense.rag.clients import RagDeps, RetrievedHit
from incident_sense.rag.postfilter import LLMPostFilter

log = get_logger(__name__)

DEFAULT_EMPRESA = "Banco Meridiano"

# --- Prompts -----------------------------------------------------------------
_SUMMARIZE_SYSTEM = (
    "Você resume um chamado de incidente para ser a consulta de busca de uma base "
    "de incidentes resolvidos. Escreva, em português, uma ou duas frases com o "
    "sintoma, o serviço afetado e o impacto, sem ruído. Escolha também as tags "
    "semânticas do assunto, somente da lista fornecida. Responda apenas com JSON."
)
_CLASSIFY_SYSTEM = (
    "Você é um analista de operações de TI de um banco. Decida se um chamado é um "
    "INCIDENTE de verdade (uma falha técnica em um sistema ou serviço que exige "
    "tratativa de operações) ou se é IMPROCEDENTE: um pedido de autoatendimento, "
    "dúvida, redefinição de senha, solicitação de acesso ou assunto administrativo "
    "que não representa falha de sistema. Responda apenas com JSON."
)
_SUGGEST_SYSTEM = (
    "Você é um analista sênior de operações de TI de um banco, escrevendo a "
    "sugestão de resolução para um novo incidente, em português.\n\n"
    "TOM: didático, claro e amigável. Escreva de um jeito que qualquer pessoa "
    "da operação entenda, sem jargão desnecessário. Ao usar uma sigla ou termo "
    "técnico pouco comum, explique o significado na primeira vez, entre "
    "parênteses.\n\n"
    "GLOSSÁRIO (use estas explicações ao mencionar as siglas):\n"
    "- DICT: Diretório de Identificadores de Contas Transacionais, o catálogo de "
    "chaves Pix do Banco Central.\n"
    "- JWT: JSON Web Token, o token que autentica o usuário.\n"
    "- DLQ: Dead Letter Queue, a fila para onde vão as mensagens com erro.\n"
    "- pool de conexões: conjunto reaproveitável de conexões com o banco de "
    "dados.\n\n"
    "REGRAS:\n"
    "1. Fundamente-se SOMENTE no contexto fornecido (incidentes resolvidos e "
    "problemas com causa raiz); não invente passos sem base nele.\n"
    "2. Cite, entre colchetes, o identificador que embasa cada ação: o número do "
    "incidente (ex.: [INC0012345]) ou do problema (ex.: [PRB0004101]). Use apenas "
    "identificadores presentes no contexto.\n"
    "3. NÃO escreva título, cabeçalho nem preâmbulo (nada de 'Sugestão de "
    "resolução:', 'Resposta:'); comece direto pela frase de diagnóstico.\n"
    "4. Deixe UMA LINHA EM BRANCO entre o diagnóstico e a lista, e entre cada "
    "item da lista (legibilidade).\n"
    "5. Não use travessões; separe a ação do detalhe com dois-pontos.\n\n"
    "FORMATO EXATO (markdown):\n"
    "<uma frase curta de diagnóstico provável, em linguagem acessível>\n\n"
    "1. **<ação>**: <detalhe objetivo e didático> [INC...]\n\n"
    "2. **<ação>**: <detalhe objetivo e didático> [PRB...]\n\n"
    "EXEMPLO de uma resposta bem formatada:\n"
    "O Internet Banking está lento porque o pool de conexões (conjunto de "
    "conexões reutilizáveis com o banco de dados) se esgotou [PRB0004103].\n\n"
    "1. **Liberar as conexões presas**: aplicar uma correção que devolve a "
    "conexão ao pool mesmo quando ocorre um erro e reiniciar as instâncias aos "
    "poucos [INC0052110].\n\n"
    "2. **Ampliar o pool temporariamente**: aumentar o número de conexões "
    "disponíveis enquanto a causa raiz é corrigida [PRB0004103]."
)


# --- Step 1: load the incident -------------------------------------------------
@dataclass(frozen=True)
class LoadedIncident:
    """The incident under analysis, as the rest of the pipeline sees it."""

    number: str | None
    short_description: str
    description: str
    category: str | None
    subcategory: str | None
    empresa: str
    tags: list[str] = field(default_factory=list)
    from_base: bool = False

    @property
    def text(self) -> str:
        """Title and description, for the steps that judge the ticket itself."""
        return f"{self.short_description}. {self.description}".strip()


def load_incident(deps: RagDeps, request: SuggestRequest) -> tuple[LoadedIncident, PipelineStep]:
    """Load the incident from the base when the request names one."""
    record = deps.incidents.get(request.number) if deps.incidents and request.number else None
    if record is not None:
        incident = LoadedIncident(
            number=record.number,
            short_description=record.short_description,
            description=record.description,
            category=record.category,
            subcategory=record.subcategory,
            empresa=record.empresa,
            tags=list(record.tags),
            from_base=True,
        )
        decision = (
            f"{record.number} carregado da base de incidentes: {record.category} / "
            f"{record.subcategory}, empresa {record.empresa}."
        )
    else:
        incident = LoadedIncident(
            number=request.number,
            short_description=request.short_description,
            description=request.description,
            category=request.category,
            subcategory=request.subcategory,
            empresa=request.empresa or DEFAULT_EMPRESA,
        )
        decision = (
            f"{request.number} não está na base; usando os dados enviados."
            if request.number
            else "Incidente recebido na requisição, sem número na base."
        )
    return incident, _step("carregar", 1, "Carregar o incidente", StepStatus.DONE, decision)


# --- Step 2: AI summary ------------------------------------------------------------
class _SummaryOut(BaseModel):
    resumo: str
    tags: list[str] = []


def summarize(
    deps: RagDeps, incident: LoadedIncident, vocabulary: frozenset[str]
) -> tuple[str, list[str], bool]:
    """Summarize the incident with the LLM; return (summary, proposed tags, degraded).

    The summary limits the whole pipeline, so a provider failure degrades to the
    ticket title rather than failing the request.
    """
    listing = ", ".join(sorted(vocabulary)) or "(nenhuma)"
    user = (
        f"Título: {incident.short_description}\n"
        f"Descrição: {incident.description}\n\n"
        f"Tags permitidas: {listing}\n\n"
        'Responda com JSON: {"resumo": "<consulta de busca>", "tags": ["<tag>", ...]}'
    )
    try:
        raw = deps.llm.complete(_SUMMARIZE_SYSTEM, user, temperature=0.0, max_tokens=200)
    except Exception as exc:  # noqa: BLE001 - degrade to the title, keep answering.
        log.warning("summary_failed", error=str(exc), error_type=type(exc).__name__)
        return incident.short_description, [], True
    try:
        parsed = _SummaryOut.model_validate(extract_json(raw))
        summary, tags = parsed.resumo.strip(), parsed.tags
    except (ValueError, ValidationError):
        lines = raw.strip().splitlines()
        summary, tags = (lines[0].strip() if lines else ""), []
    if not summary:
        return incident.short_description, tags, True
    return summary[:400], tags, False


# --- Step 3: embed the summary with categoria, subcategoria and empresa ------------
def build_query_text(summary: str, incident: LoadedIncident) -> str:
    """The query: the summary concatenated with the structured fields."""
    return (
        f"{summary}\n"
        f"Categoria: {incident.category or 'não informada'}\n"
        f"Subcategoria: {incident.subcategory or 'não informada'}\n"
        f"Empresa: {incident.empresa}"
    )


EMBEDDING_PREVIEW_SIZE = 24


def embedding_preview(vector: list[float], size: int = EMBEDDING_PREVIEW_SIZE) -> list[float]:
    """The first ``size`` values of the query vector, rounded to 3 places.

    Enough for the UI to show the text becoming numbers; the full vector
    (thousands of floats) never leaves the server.
    """
    return [round(float(v), 3) for v in vector[:size]]


def embed_query(deps: RagDeps, query: str) -> list[float]:
    """Embed the retrieval query."""
    return deps.embeddings.embed(query)


# --- Step 4, layer 1: semantic tags --------------------------------------------------
def resolve_tags(deps: RagDeps, incident: LoadedIncident, ai_tags: list[str]) -> TagLayer:
    """Pick the tags that decide where to search.

    Order: the incident's own semantic tags, then the ones the AI summary chose
    from the vocabulary, then the usual tags of its category and subcategory.
    With none, the search stays broad.
    """
    catalog = deps.catalog
    source: Literal["incidente", "ia", "catalogo", "nenhuma"]
    if own := catalog.constrain(incident.tags):
        tags, source = own, "incidente"
    elif chosen := catalog.constrain(ai_tags):
        tags, source = chosen, "ia"
    elif inferred := catalog.infer(incident.category, incident.subcategory):
        tags, source = inferred, "catalogo"
    else:
        tags, source = [], "nenhuma"
    origin = {
        "incidente": "do próprio incidente",
        "ia": "escolhidas pela IA no resumo",
        "catalogo": "usuais da categoria e subcategoria",
        "nenhuma": "",
    }[source]
    decision = (
        f"Procurar só entre registros com as tags {', '.join(tags)} ({origin})."
        if tags
        else "Nenhuma tag semântica reconhecida: busca em toda a base."
    )
    return TagLayer(tags=tags, source=source, filter_applied=bool(tags), decision=decision)


def tag_filter(tags: list[str]) -> qm.Filter | None:
    """A Qdrant filter matching records that share at least one tag."""
    if not tags:
        return None
    return qm.Filter(must=[qm.FieldCondition(key="tags", match=qm.MatchAny(any=tags))])


# --- Step 4, layer 2: vector ---------------------------------------------------------
def retrieve(
    deps: RagDeps,
    vector: list[float],
    *,
    top_k: int,
    min_similarity: float,
    query_filter: qm.Filter | None,
) -> list[RetrievedHit]:
    """Top-k vector search over incidents, keeping hits at/above the cosine floor."""
    hits = deps.retriever.search(vector, top_k=top_k, query_filter=query_filter)
    return [hit for hit in hits if hit.score >= min_similarity]


def vector_layer(
    deps: RagDeps, vector: list[float], query_filter: qm.Filter | None, settings: Settings
) -> tuple[VectorLayer, list[RetrievedHit], list[RetrievedHit]]:
    """Search both collections and mark which hits clear the cosine floor."""
    floor = settings.retrieval_min_similarity
    incident_hits = deps.retriever.search(
        vector, top_k=settings.incident_top_k, query_filter=query_filter
    )[: settings.incident_top_k]
    problem_hits = deps.problem_retriever.search(
        vector, top_k=settings.problem_top_k, query_filter=query_filter
    )[: settings.problem_top_k]

    def report(hits: list[RetrievedHit], kind: Literal["incidente", "problema"]) -> list[VectorHit]:
        return [
            VectorHit(
                number=hit.number,
                kind=kind,
                short_description=str(hit.payload.get("short_description", "")),
                similarity=hit.score,
                passed=hit.score >= floor,
            )
            for hit in hits
        ]

    passed_incidents = [hit for hit in incident_hits if hit.score >= floor]
    passed_problems = [hit for hit in problem_hits if hit.score >= floor]
    decision = (
        f"Cosseno mínimo {_decimal(floor)}: {len(passed_incidents)} de {len(incident_hits)} "
        f"incidentes (top-K {settings.incident_top_k}) e {len(passed_problems)} de "
        f"{len(problem_hits)} problemas (top-K {settings.problem_top_k}) passaram."
    )
    layer = VectorLayer(
        min_similarity=floor,
        incident_top_k=settings.incident_top_k,
        problem_top_k=settings.problem_top_k,
        incidents=report(incident_hits, "incidente"),
        problems=report(problem_hits, "problema"),
        decision=decision,
    )
    return layer, passed_incidents, passed_problems


# --- Step 4, layer 3: LLM post-filter --------------------------------------------------
def _to_nodes(hits: list[RetrievedHit], kind: str) -> list[NodeWithScore]:
    nodes: list[NodeWithScore] = []
    for hit in hits:
        metadata: dict[str, Any] = {
            **hit.payload,
            "number": hit.number,
            "similarity": hit.score,
            "kind": kind,
        }
        text = (
            hit.payload.get("resolution_notes")
            or hit.payload.get("root_cause")
            or hit.payload.get("short_description", "")
        )
        nodes.append(NodeWithScore(node=TextNode(text=text, metadata=metadata), score=hit.score))
    return nodes


def post_filter(
    deps: RagDeps,
    incident_text: str,
    incident_hits: list[RetrievedHit],
    problem_hits: list[RetrievedHit] | None = None,
) -> tuple[list[NodeWithScore], PostFilterLayer]:
    """Ask the LLM which candidates actually help; fall back to the original list."""
    nodes = _to_nodes(incident_hits, "incidente") + _to_nodes(problem_hits or [], "problema")
    if not nodes:
        return [], PostFilterLayer(
            status="sem_candidatos",
            verdicts=[],
            decision="Nada passou do vetor: não há o que pós-filtrar.",
        )
    post_processor = LLMPostFilter(llm=deps.llm)
    processed = list(
        post_processor.postprocess_nodes(nodes, query_bundle=QueryBundle(query_str=incident_text))
    )
    verdicts = [
        PostFilterVerdict(
            number=str(node.node.metadata.get("number", "")),
            kind=node.node.metadata.get("kind", "incidente"),
            kept=bool(node.node.metadata.get("survived", True)),
            reason=str(node.node.metadata.get("postfilter_reason", "")),
        )
        for node in processed
    ]
    kept = sum(1 for verdict in verdicts if verdict.kept)
    if post_processor.status == "fallback":
        layer = PostFilterLayer(
            status="fallback",
            verdicts=verdicts,
            fallback_reason=post_processor.fallback_reason,
            decision=(
                f"O pós-filtro falhou; a lista original "
                f"({_plural(kept, 'candidato', 'candidatos')}) foi mantida "
                "em vez de derrubar a função."
            ),
        )
    else:
        layer = PostFilterLayer(
            status="ok",
            verdicts=verdicts,
            decision=f"Manteve {kept} e descartou {len(verdicts) - kept} candidatos.",
        )
    return processed, layer


# --- Gate: procedente? -----------------------------------------------------------------
class _ClassificationOut(BaseModel):
    """Schema the LLM classification is validated into."""

    classification: Classification
    justification: str = ""


def classify_with_reason(
    deps: RagDeps, incident: LoadedIncident, has_context: bool
) -> tuple[Classification, str]:
    """Decide whether the ticket is a genuine incident, with a short justification.

    The verdict is about the ticket itself: a real technical failure (PROCEDENTE)
    versus a self-service request, a how-to question or an access request
    (IMPROCEDENTE). It is independent of retrieval; retrieval only decides
    whether there is evidence to propose something.
    """
    user = (
        f"CHAMADO\nTítulo: {incident.short_description}\n"
        f"Descrição: {incident.description}\n\n"
        'Responda com JSON: {"classification": "PROCEDENTE" ou "IMPROCEDENTE", '
        '"justification": "<frase curta>"}.\n'
        "PROCEDENTE = é um incidente técnico real (serviço fora do ar, erro, "
        "timeout, lentidão, falha de processamento, indisponibilidade).\n"
        'IMPROCEDENTE = não é um incidente (ex.: "esqueci minha senha", '
        '"como faço para...", pedido de acesso, dúvida, assunto administrativo).'
    )
    raw = deps.llm.complete(_CLASSIFY_SYSTEM, user, temperature=0.0, max_tokens=300)
    try:
        parsed = _ClassificationOut.model_validate(extract_json(raw))
        return parsed.classification, parsed.justification.strip()
    except (ValueError, ValidationError):
        # On a parse failure, fall back to the retrieval signal: a real match
        # suggests a real incident; otherwise stay conservative.
        fallback = Classification.PROCEDENTE if has_context else Classification.IMPROCEDENTE
        return fallback, "classificação inferida pela recuperação (resposta da IA inválida)"


def classify(
    deps: RagDeps, incident: LoadedIncident, surviving: list[NodeWithScore]
) -> Classification:
    """The classification alone (see :func:`classify_with_reason`)."""
    return classify_with_reason(deps, incident, bool(surviving))[0]


# --- Step 6: suggestion with sources -----------------------------------------------------
# A leading "**Sugestão de Resolução:**"-style heading the model sometimes adds
# despite the prompt; the UI renders its own heading, so we drop this duplicate.
# Only a *bold-only* first line that either mentions "sugestão" or ends with a
# colon counts as a heading, so a genuine bolded diagnosis is preserved.
_TITLE_LINE = re.compile(r"^\*\*\s*(?:sugest[^*]*|[^*]*:)\s*\*\*\s*$", re.IGNORECASE)


def _strip_redundant_title(text: str) -> str:
    """Drop a leading bold "Sugestão de Resolução:" heading if the model adds one."""
    lines = text.lstrip().splitlines()
    if lines and _TITLE_LINE.match(lines[0].strip()):
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines.pop(0)
    return "\n".join(lines).strip()


def _context_block(incidents: list[NodeWithScore], problems: list[NodeWithScore]) -> str:
    parts: list[str] = []
    for node in incidents:
        meta = node.node.metadata
        parts.append(
            f"[{meta.get('number', '')}] {meta.get('short_description', '')}\n"
            f"Resolução: {meta.get('resolution_notes', '')}"
        )
    for node in problems:
        meta = node.node.metadata
        parts.append(
            f"[{meta.get('number', '')}] Problema: {meta.get('short_description', '')}\n"
            f"Causa raiz: {meta.get('root_cause', '')}\n"
            f"Contorno: {meta.get('workaround', '')}\n"
            f"Solução definitiva: {meta.get('permanent_fix', '')}"
        )
    return "\n\n".join(parts)


def generate_suggestion(
    deps: RagDeps,
    incident: LoadedIncident,
    incidents: list[NodeWithScore],
    problems: list[NodeWithScore] | None = None,
) -> str:
    """Write a resolution grounded only in the context."""
    user = (
        f"NOVO INCIDENTE\n{incident.text}\n\n"
        "CONTEXTO (incidentes resolvidos e problemas; cite estes identificadores):\n"
        f"{_context_block(incidents, problems or [])}\n\n"
        "Escreva a sugestão seguindo EXATAMENTE o formato e as regras."
    )
    raw = deps.llm.complete(_SUGGEST_SYSTEM, user, temperature=0.2, max_tokens=700)
    return _strip_redundant_title(raw.strip())


_ID = re.compile(r"\b(?:INC|PRB)\d{4,}\b")
_BRACKET = re.compile(r"[ \t]?\[([^\[\]]*)\]")


def validate_citations(text: str, context_ids: list[str]) -> tuple[str, CitationCheck]:
    """Keep only citations of ids that are in the retrieved context.

    A bracketed citation of an unknown id is removed (``removida``); a bare
    mention outside brackets is kept but marked in the text and reported
    (``sinalizada``), so the reader knows it has no source behind it.
    """
    allowed = set(context_ids)
    flagged: dict[str, CitationFlag] = {}

    def fix_bracket(match: re.Match[str]) -> str:
        ids = _ID.findall(match.group(1))
        if not ids:
            return match.group(0)  # not a citation (e.g. a markdown link text)
        valid = [i for i in ids if i in allowed]
        for invalid in (i for i in ids if i not in allowed):
            flagged.setdefault(invalid, CitationFlag(id=invalid, action="removida"))
        if not valid:
            return ""
        lead = match.group(0)[0] if match.group(0)[0] in " \t" else ""
        return f"{lead}[{', '.join(valid)}]"

    cleaned = _BRACKET.sub(fix_bracket, text)

    # Bare mentions: everything outside brackets.
    out: list[str] = []
    cursor = 0
    for bracket in re.finditer(r"\[[^\[\]]*\]", cleaned):
        out.append(_mark_bare(cleaned[cursor : bracket.start()], allowed, flagged))
        out.append(bracket.group(0))
        cursor = bracket.end()
    out.append(_mark_bare(cleaned[cursor:], allowed, flagged))
    final = "".join(out)

    cited: list[str] = []
    for found in _ID.findall(final):
        if found in allowed and found not in cited:
            cited.append(found)
    return final, CitationCheck(cited=cited, flagged=list(flagged.values()))


def _mark_bare(segment: str, allowed: set[str], flagged: dict[str, CitationFlag]) -> str:
    def mark(match: re.Match[str]) -> str:
        found = match.group(0)
        if found in allowed:
            return found
        flagged.setdefault(found, CitationFlag(id=found, action="sinalizada"))
        return f"{found} (fora das fontes)"

    return _ID.sub(mark, segment)


# --- Orchestrator ----------------------------------------------------------------------
def _step(
    step_id: Any, order: int, title: str, status: StepStatus, decision: str, *, gate: bool = False
) -> PipelineStep:
    return PipelineStep(
        id=step_id, order=order, title=title, status=status, decision=decision, gate=gate
    )


def _to_candidate(node: NodeWithScore) -> RetrievedCandidate:
    metadata = node.node.metadata
    return RetrievedCandidate(
        number=str(metadata.get("number", "")),
        short_description=str(metadata.get("short_description", "")),
        cmdb_ci=str(metadata.get("cmdb_ci", "")),
        category=str(metadata.get("category", "")),
        similarity=float(node.score or 0.0),
        resolution_notes=metadata.get("resolution_notes"),
        close_code=metadata.get("close_code"),
        survived_postfilter=bool(metadata.get("survived", True)),
        postfilter_reason=metadata.get("postfilter_reason"),
    )


def _to_problem(node: NodeWithScore) -> RetrievedProblem:
    metadata = node.node.metadata
    return RetrievedProblem(
        number=str(metadata.get("number", "")),
        short_description=str(metadata.get("short_description", "")),
        root_cause=str(metadata.get("root_cause", "")),
        workaround=str(metadata.get("workaround", "")),
        permanent_fix=str(metadata.get("permanent_fix", "")),
        linked_incidents=len(metadata.get("linked_incidents") or []),
        similarity=float(node.score or 0.0),
        survived_postfilter=bool(metadata.get("survived", True)),
        postfilter_reason=metadata.get("postfilter_reason"),
    )


def _decimal(value: float) -> str:
    """A number with the PT-BR decimal comma (0,8)."""
    return f"{value:g}".replace(".", ",")


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def run_suggestion(
    request: SuggestRequest, deps: RagDeps, settings: Settings, *, model: str | None = None
) -> SuggestResponse:
    """Run the seven steps and assemble the transparent response."""
    steps: list[PipelineStep] = []

    # 1. Load.
    incident, load_step = load_incident(deps, request)
    steps.append(load_step)

    # 2. AI summary.
    summary, ai_tags, degraded = summarize(deps, incident, deps.catalog.vocabulary)
    steps.append(
        _step(
            "resumir",
            2,
            "Resumo por IA",
            StepStatus.FALLBACK if degraded else StepStatus.DONE,
            (
                f"A IA não respondeu; o título virou a consulta: “{summary}”."
                if degraded
                else f"Resumo usado como consulta: “{summary}”."
            ),
        )
    )

    # 3. Embedding of summary + categoria, subcategoria, empresa.
    query_text = build_query_text(summary, incident)
    vector = embed_query(deps, query_text)
    steps.append(
        _step(
            "embedding",
            3,
            "Embedding do resumo",
            StepStatus.DONE,
            (
                f"Vetor de {len(vector)} dimensões do resumo com categoria "
                f"{incident.category or 'não informada'}, subcategoria "
                f"{incident.subcategory or 'não informada'} e empresa {incident.empresa}."
            ),
        )
    )

    # 4. Three-layer retrieval.
    tags = resolve_tags(deps, incident, ai_tags)
    vector_trace, incident_hits, problem_hits = vector_layer(
        deps, vector, tag_filter(tags.tags), settings
    )
    nodes, postfilter = post_filter(deps, incident.text, incident_hits, problem_hits)
    surviving = [node for node in nodes if node.node.metadata.get("survived", True)]
    kept_incidents = [n for n in surviving if n.node.metadata.get("kind") == "incidente"]
    kept_problems = [n for n in surviving if n.node.metadata.get("kind") == "problema"]
    steps.append(
        _step(
            "recuperar",
            4,
            "Recuperação em três camadas",
            StepStatus.FALLBACK if postfilter.status == "fallback" else StepStatus.DONE,
            (
                "Tags, vetor e pós-filtro: "
                f"{_plural(len(kept_incidents), 'incidente', 'incidentes')} e "
                f"{_plural(len(kept_problems), 'problema', 'problemas')} servem de base."
                + (
                    " Pós-filtro indisponível: lista original mantida."
                    if postfilter.status == "fallback"
                    else ""
                )
            ),
        )
    )

    # 5. Context.
    incident_ids = [str(n.node.metadata.get("number", "")) for n in kept_incidents]
    problem_ids = [str(n.node.metadata.get("number", "")) for n in kept_problems]
    context_ids = incident_ids + problem_ids
    steps.append(
        _step(
            "contexto",
            5,
            "Contexto de casos semelhantes",
            StepStatus.DONE,
            (
                f"Contexto com {', '.join(context_ids)}."
                if context_ids
                else "Nenhum caso semelhante passou pelas três camadas: contexto vazio."
            ),
        )
    )

    # Gate: is the incident procedente?
    classification, justification = classify_with_reason(deps, incident, bool(context_ids))
    procedente = classification == Classification.PROCEDENTE
    generates = procedente and bool(context_ids)
    if not procedente:
        gate_text = "Improcedente: não é falha técnica. Classificar sem propor também é resposta."
    elif not context_ids:
        gate_text = "Procedente, mas sem evidência no contexto: não dá para propor com segurança."
    else:
        gate_text = "Procedente: segue para a sugestão com fontes."
    if justification:
        gate_text = f"{gate_text} Justificativa: {justification}"
    decision = ProcedenciaDecision(
        classification=classification,
        justification=justification,
        generates_suggestion=generates,
        decision=gate_text,
    )
    steps.append(
        _step("decidir", 5, "Incidente procedente?", StepStatus.DONE, gate_text, gate=True)
    )

    # 6. Suggestion with sources.
    suggestion: str | None = None
    citations = CitationCheck()
    if generates:
        raw = generate_suggestion(deps, incident, kept_incidents, kept_problems)
        suggestion, citations = validate_citations(raw, context_ids)
        if citations.flagged:
            removed = sum(1 for f in citations.flagged if f.action == "removida")
            marked = len(citations.flagged) - removed
            parts = [
                _plural(removed, "removida", "removidas") if removed else "",
                _plural(marked, "sinalizada", "sinalizadas") if marked else "",
            ]
            check = (
                f"{_plural(len(citations.flagged), 'citação', 'citações')} fora do contexto "
                f"recuperado: {' e '.join(p for p in parts if p)}."
            )
        else:
            check = "todas as citações estão no contexto recuperado."
        steps.append(
            _step(
                "sugerir",
                6,
                "Sugestão com fontes",
                StepStatus.DONE,
                f"Sugestão citando {_plural(len(citations.cited), 'fonte', 'fontes')}; {check}",
            )
        )
    else:
        steps.append(
            _step(
                "sugerir",
                6,
                "Sugestão com fontes",
                StepStatus.SKIPPED,
                "Sem sugestão: improcedente."
                if not procedente
                else "Sem sugestão: sem evidência não se propõe resolução.",
            )
        )

    # 7. Publication on the incident.
    publication = _publish(deps, incident, suggestion, context_ids, model)
    steps.append(
        _step(
            "publicar",
            7,
            "Publicação no incidente",
            StepStatus.DONE if publication.published else StepStatus.SKIPPED,
            publication.decision,
        )
    )

    return SuggestResponse(
        incident_number=incident.number if incident.from_base else None,
        summarized_query=summary,
        query_text=query_text,
        embedding_preview=embedding_preview(vector),
        dims=len(vector),
        classification=classification,
        suggestion=suggestion,
        candidates=[_to_candidate(n) for n in nodes if n.node.metadata.get("kind") == "incidente"],
        referenced_incidents=incident_ids if generates else [],
        problems=[_to_problem(n) for n in nodes if n.node.metadata.get("kind") == "problema"],
        referenced_problems=problem_ids if generates else [],
        context_ids=context_ids,
        steps=steps,
        retrieval=RetrievalTrace(tags=tags, vector=vector_trace, postfilter=postfilter),
        decision=decision,
        citations=citations,
        publication=publication,
    )


def _publish(
    deps: RagDeps,
    incident: LoadedIncident,
    suggestion: str | None,
    sources: list[str],
    model: str | None,
) -> Publication:
    if suggestion is None:
        return Publication(published=False, decision="Nada a publicar: não houve sugestão.")
    if not incident.from_base or incident.number is None or deps.notes is None:
        return Publication(
            published=False,
            decision="Incidente fora da base: a sugestão fica só nesta resposta.",
        )
    note = deps.notes.publish(incident.number, suggestion, sources=sources, model=model)
    return Publication(
        published=True,
        incident_number=incident.number,
        note=note,
        decision=f"Sugestão publicada nas notas de trabalho do {incident.number}.",
    )
