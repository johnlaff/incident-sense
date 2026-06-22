"""LLM post-filter, implemented as a LlamaIndex node postprocessor.

Vector search is recall-oriented: it can surface a past incident that merely
shares vocabulary with the new one ("lentidão", "erro") but has nothing to do
with it. After retrieval we therefore ask the LLM, in a single call, whether
each candidate is *actually* relevant. Each node is annotated with a
``survived`` flag and a short ``postfilter_reason`` so the API can show the
reasoning instead of silently dropping candidates.
"""

from __future__ import annotations

from llama_index.core.bridge.pydantic import PrivateAttr
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.schema import NodeWithScore, QueryBundle

from incident_sense.providers import extract_json
from incident_sense.rag.clients import LLMClient

_SYSTEM = (
    "Você é um analista de operações de TI de um banco. Dado um NOVO incidente "
    "e uma lista de incidentes passados já resolvidos, decida quais passados são "
    "REALMENTE relevantes para ajudar a resolver o novo (mesmo problema/causa), "
    "ignorando os que apenas compartilham palavras. Responda apenas com JSON."
)


def _judge_prompt(new_incident: str, listing: str) -> str:
    return (
        f"NOVO incidente:\n{new_incident}\n\n"
        f"Incidentes passados (número: descrição):\n{listing}\n\n"
        "Devolva um array JSON onde cada item tem as chaves: "
        '"number" (o número do passado), "relevant" (true/false) e '
        '"reason" (uma frase curta em português).'
    )


class LLMPostFilter(BaseNodePostprocessor):
    """Annotate each candidate node with the LLM's relevance verdict."""

    # The LLM is injected (and thus mockable); PrivateAttr keeps it off the
    # serialized pydantic model that BaseNodePostprocessor is built on.
    _llm: LLMClient = PrivateAttr()

    def __init__(self, llm: LLMClient) -> None:
        super().__init__()
        self._llm = llm

    @classmethod
    def class_name(cls) -> str:
        """LlamaIndex component identifier."""
        return "LLMPostFilter"

    def _postprocess_nodes(
        self, nodes: list[NodeWithScore], query_bundle: QueryBundle | None = None
    ) -> list[NodeWithScore]:
        if not nodes:
            return nodes
        new_incident = query_bundle.query_str if query_bundle else ""
        verdicts = self._judge(new_incident, nodes)
        for node in nodes:
            number = str(node.node.metadata.get("number", ""))
            relevant, reason = verdicts.get(number, (True, "não avaliado"))
            node.node.metadata["survived"] = relevant
            node.node.metadata["postfilter_reason"] = reason
        # Keep all nodes for transparency, surviving ones first.
        return sorted(nodes, key=lambda node: not node.node.metadata.get("survived", True))

    def _judge(
        self, new_incident: str, nodes: list[NodeWithScore]
    ) -> dict[str, tuple[bool, str]]:
        """Ask the LLM for a relevance verdict per candidate (one call)."""
        listing = "\n".join(
            f"- {node.node.metadata.get('number', '')}: "
            f"{node.node.metadata.get('short_description', '')}"
            for node in nodes
        )
        raw = self._llm.complete(
            _SYSTEM, _judge_prompt(new_incident, listing), temperature=0.0, max_tokens=900
        )
        try:
            data = extract_json(raw)
        except ValueError:
            return {}
        items = data if isinstance(data, list) else data.get("avaliacoes", [])
        verdicts: dict[str, tuple[bool, str]] = {}
        for item in items:
            if isinstance(item, dict) and "number" in item:
                verdicts[str(item["number"])] = (
                    bool(item.get("relevant", True)),
                    str(item.get("reason", "")),
                )
        return verdicts
