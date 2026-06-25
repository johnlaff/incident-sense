"""The resolution-suggestion pipeline, one small step per function.

Flow (each step is independently testable and mock-friendly):

    summarize -> embed -> pre-filter -> retrieve -> post-filter
    -> classify -> (suggest) -> assemble response

Every retrieved candidate is reported back with its similarity score and whether
it survived the post-filter — surfacing the reasoning is a goal of the project.
"""

from __future__ import annotations

import re
from typing import Any

from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from pydantic import BaseModel, ValidationError
from qdrant_client import models as qm

from incident_sense.config import Settings
from incident_sense.models import (
    Classification,
    RetrievedCandidate,
    SuggestRequest,
    SuggestResponse,
)
from incident_sense.providers import extract_json
from incident_sense.rag.clients import RagDeps, RetrievedHit
from incident_sense.rag.postfilter import LLMPostFilter

# --- Prompts -----------------------------------------------------------------
_SUMMARIZE_SYSTEM = (
    "Você condensa um chamado de incidente em uma consulta de busca curta, em "
    "português, contendo apenas os termos técnicos essenciais (sintoma, serviço "
    "afetado). Responda somente com a consulta, em uma linha."
)
_CLASSIFY_SYSTEM = (
    "Você é um analista de operações de TI de um banco. Decida se um chamado é um "
    "INCIDENTE de verdade — uma falha técnica em um sistema ou serviço que exige "
    "tratativa de operações — ou se é IMPROCEDENTE: um pedido de autoatendimento, "
    "dúvida, redefinição de senha, solicitação de acesso ou assunto administrativo "
    "que não representa falha de sistema. Responda apenas com JSON."
)
_SUGGEST_SYSTEM = (
    "Você é um analista sênior de operações de TI de um banco, escrevendo a "
    "sugestão de resolução para um novo incidente, em português.\n\n"
    "TOM: didático, claro e amigável — escreva de um jeito que qualquer pessoa "
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
    "1. Fundamente-se SOMENTE nas resoluções passadas fornecidas no contexto; "
    "não invente passos sem base nelas.\n"
    "2. Cite, entre colchetes, o número do incidente que embasa cada ação (ex.: "
    "[INC0012345]). Use apenas números presentes no contexto.\n"
    "3. NÃO escreva título, cabeçalho nem preâmbulo (nada de 'Sugestão de "
    "resolução:', 'Resposta:'); comece direto pela frase de diagnóstico.\n"
    "4. Deixe UMA LINHA EM BRANCO entre o diagnóstico e a lista, e entre cada "
    "item da lista (legibilidade).\n\n"
    "FORMATO EXATO (markdown):\n"
    "<uma frase curta de diagnóstico provável, em linguagem acessível>\n\n"
    "1. **<ação>** — <detalhe objetivo e didático> [INC...]\n\n"
    "2. **<ação>** — <detalhe objetivo e didático> [INC...]\n\n"
    "EXEMPLO de uma resposta bem formatada:\n"
    "O Internet Banking está lento porque o pool de conexões (conjunto de "
    "conexões reutilizáveis com o banco de dados) se esgotou.\n\n"
    "1. **Liberar as conexões presas** — aplicar uma correção que devolve a "
    "conexão ao pool mesmo quando ocorre um erro e reiniciar as instâncias aos "
    "poucos [INC0052110].\n\n"
    "2. **Ampliar o pool temporariamente** — aumentar o número de conexões "
    "disponíveis enquanto a causa raiz é corrigida [INC0052110]."
)


def _incident_text(request: SuggestRequest) -> str:
    return f"{request.short_description}. {request.description}".strip()


# --- Step 1: summarize -------------------------------------------------------
def summarize_query(deps: RagDeps, request: SuggestRequest) -> str:
    """Condense the incident into a short retrieval query via the LLM."""
    user = (
        f"Título: {request.short_description}\n"
        f"Descrição: {request.description}\n\nConsulta de busca:"
    )
    out = deps.llm.complete(_SUMMARIZE_SYSTEM, user, temperature=0.0, max_tokens=80).strip()
    return out.splitlines()[0][:200] if out else request.short_description


# --- Step 2: embed -----------------------------------------------------------
def embed_query(deps: RagDeps, query: str) -> list[float]:
    """Embed the retrieval query."""
    return deps.embeddings.embed(query)


# --- Step 3: optional metadata pre-filter ------------------------------------
def build_prefilter(request: SuggestRequest) -> qm.Filter | None:
    """Narrow the search by category/cmdb_ci when those hints are provided.

    Uses ``should`` (logical OR): a candidate matching either hint qualifies.
    Returns ``None`` when no hints are given, so retrieval stays broad.
    """
    # Typed as Any because Qdrant's `should` expects an invariant union list.
    conditions: list[Any] = []
    if request.category:
        conditions.append(
            qm.FieldCondition(key="category", match=qm.MatchValue(value=request.category))
        )
    if request.cmdb_ci:
        conditions.append(
            qm.FieldCondition(key="cmdb_ci", match=qm.MatchValue(value=request.cmdb_ci))
        )
    return qm.Filter(should=conditions) if conditions else None


# --- Step 4: vector search ---------------------------------------------------
def retrieve(
    deps: RagDeps,
    vector: list[float],
    *,
    top_k: int,
    min_similarity: float,
    query_filter: qm.Filter | None,
) -> list[RetrievedHit]:
    """Top-k vector search, keeping only hits at/above the similarity floor."""
    hits = deps.retriever.search(vector, top_k=top_k, query_filter=query_filter)
    return [hit for hit in hits if hit.score >= min_similarity]


# --- Step 5: LLM post-filter -------------------------------------------------
def _to_nodes(hits: list[RetrievedHit]) -> list[NodeWithScore]:
    nodes: list[NodeWithScore] = []
    for hit in hits:
        metadata: dict[str, Any] = {**hit.payload, "number": hit.number, "similarity": hit.score}
        text = hit.payload.get("resolution_notes") or hit.payload.get("short_description", "")
        nodes.append(NodeWithScore(node=TextNode(text=text, metadata=metadata), score=hit.score))
    return nodes


def post_filter(
    deps: RagDeps, request: SuggestRequest, hits: list[RetrievedHit]
) -> list[NodeWithScore]:
    """Run the LlamaIndex post-filter, annotating each node with its verdict."""
    nodes = _to_nodes(hits)
    post_processor = LLMPostFilter(llm=deps.llm)
    processed = post_processor.postprocess_nodes(
        nodes, query_bundle=QueryBundle(query_str=_incident_text(request))
    )
    return list(processed)


# --- Step 6: classification (structured output) ------------------------------
class _ClassificationOut(BaseModel):
    """Schema the LLM classification is validated into."""

    classification: Classification
    justification: str = ""


def classify(
    deps: RagDeps, request: SuggestRequest, surviving: list[NodeWithScore]
) -> Classification:
    """Decide whether the new ticket is a genuine incident or not.

    The verdict is about the ticket itself: a real technical failure that needs
    operations work (PROCEDENTE) versus a non-incident such as a password reset,
    a how-to question or an access request (IMPROCEDENTE). It is deliberately
    *independent of retrieval*: a real incident with no similar past case is
    still PROCEDENTE (the caller then has no base to ground a suggestion on, and
    the response carries an empty suggestion), and a non-incident is IMPROCEDENTE
    even when vocabulary-similar cases happen to be retrieved.
    """
    user = (
        f"CHAMADO\nTítulo: {request.short_description}\n"
        f"Descrição: {request.description}\n\n"
        'Responda com JSON: {"classification": "PROCEDENTE" ou "IMPROCEDENTE", '
        '"justification": "<frase curta>"}.\n'
        "PROCEDENTE = é um incidente técnico real (serviço fora do ar, erro, "
        "timeout, lentidão, falha de processamento, indisponibilidade).\n"
        'IMPROCEDENTE = não é um incidente (ex.: "esqueci minha senha", '
        '"como faço para...", pedido de acesso, dúvida, assunto administrativo).'
    )
    raw = deps.llm.complete(_CLASSIFY_SYSTEM, user, temperature=0.0, max_tokens=300)
    try:
        return _ClassificationOut.model_validate(extract_json(raw)).classification
    except (ValueError, ValidationError):
        # On a parse failure, fall back to the retrieval signal: a real match
        # suggests a real incident; otherwise stay conservative.
        return Classification.PROCEDENTE if surviving else Classification.IMPROCEDENTE


# --- Step 7: grounded suggestion ---------------------------------------------
# A leading "**Sugestão de Resolução:**"-style heading the model sometimes adds
# despite the prompt; the UI renders its own heading, so we drop this duplicate.
# Only a *bold-only* first line that either mentions "sugestão" or ends with a
# colon counts as a heading — so a genuine bolded diagnosis like
# "**Falha no PIX-Core**" is preserved.
_TITLE_LINE = re.compile(r"^\*\*\s*(?:sugest[^*]*|[^*]*:)\s*\*\*\s*$", re.IGNORECASE)


def _strip_redundant_title(text: str) -> str:
    """Drop a leading bold "Sugestão de Resolução:" heading if the model adds one."""
    lines = text.lstrip().splitlines()
    if lines and _TITLE_LINE.match(lines[0].strip()):
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines.pop(0)
    return "\n".join(lines).strip()


def generate_suggestion(
    deps: RagDeps, request: SuggestRequest, surviving: list[NodeWithScore]
) -> str:
    """Write a resolution grounded in the surviving candidates' notes."""
    grounding = "\n\n".join(
        f"[{node.node.metadata.get('number', '')}] "
        f"{node.node.metadata.get('short_description', '')}\n"
        f"Resolução: {node.node.metadata.get('resolution_notes', '')}"
        for node in surviving
    )
    user = (
        f"NOVO INCIDENTE\n{_incident_text(request)}\n\n"
        "RESOLUÇÕES PASSADAS (contexto para fundamentar; cite estes números):\n"
        f"{grounding}\n\n"
        "Escreva a sugestão seguindo EXATAMENTE o formato e as regras."
    )
    raw = deps.llm.complete(_SUGGEST_SYSTEM, user, temperature=0.2, max_tokens=700)
    return _strip_redundant_title(raw.strip())


# --- Orchestrator ------------------------------------------------------------
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


def run_suggestion(request: SuggestRequest, deps: RagDeps, settings: Settings) -> SuggestResponse:
    """Run the full pipeline and assemble the transparent response."""
    query = summarize_query(deps, request)
    vector = embed_query(deps, query)
    query_filter = build_prefilter(request)
    hits = retrieve(
        deps,
        vector,
        top_k=settings.example_top_k,
        min_similarity=settings.example_min_similarity,
        query_filter=query_filter,
    )
    nodes = post_filter(deps, request, hits)
    surviving = [node for node in nodes if node.node.metadata.get("survived", True)]

    # Three outcomes the UI distinguishes:
    #   IMPROCEDENTE          -> not a real incident (no suggestion).
    #   PROCEDENTE, no base   -> real incident, but nothing similar survived the
    #                            post-filter, so there is no grounded suggestion.
    #   PROCEDENTE, with base -> real incident grounded on past resolutions.
    classification = classify(deps, request, surviving)
    suggestion: str | None = None
    referenced: list[str] = []
    if classification == Classification.PROCEDENTE and surviving:
        suggestion = generate_suggestion(deps, request, surviving)
        referenced = [str(node.node.metadata.get("number", "")) for node in surviving]

    return SuggestResponse(
        summarized_query=query,
        classification=classification,
        suggestion=suggestion,
        candidates=[_to_candidate(node) for node in nodes],
        referenced_incidents=referenced,
    )
