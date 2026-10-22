"""LLM post-filter, implemented as a LlamaIndex node postprocessor.

Vector search is recall-oriented: it can surface a past incident that merely
shares vocabulary with the new one ("lentidão", "erro") but has nothing to do
with it. After retrieval we therefore ask the LLM, in a single call, whether
each candidate is *actually* relevant. Each node is annotated with a
``survived`` flag and a short ``postfilter_reason`` so the API can show the
reasoning instead of silently dropping candidates.

If the post-filter fails (the provider errors, or the answer has no usable
verdict), the original list comes back untouched and ``status`` says
``fallback``: degrading precision is acceptable, leaving the incident without an
answer is not.
"""

from __future__ import annotations

from llama_index.core.bridge.pydantic import PrivateAttr
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.schema import NodeWithScore, QueryBundle

from incident_sense.logging import get_logger
from incident_sense.prompts import UNTRUSTED_INPUT_NOTICE
from incident_sense.providers import extract_json
from incident_sense.rag.clients import LLMClient

log = get_logger(__name__)

FALLBACK_REASON = "pós-filtro indisponível: lista original mantida"

_SYSTEM = (
    "Você é um analista de operações de TI de um banco. Dado um NOVO incidente "
    "e uma lista de incidentes passados já resolvidos, decida quais passados são "
    "REALMENTE relevantes para ajudar a resolver o novo (mesmo problema/causa), "
    "ignorando os que apenas compartilham palavras. Responda apenas com JSON. "
    + UNTRUSTED_INPUT_NOTICE
)


def _judge_prompt(new_incident: str, listing: str) -> str:
    return (
        f"NOVO incidente:\n{new_incident}\n\n"
        f"Casos passados (número: título; descrição; como foi resolvido):\n{listing}\n\n"
        "Devolva um array JSON onde cada item tem as chaves: "
        '"number" (o número do passado), "relevant" (true/false) e '
        '"reason" (uma frase curta em português).'
    )


class LLMPostFilter(BaseNodePostprocessor):
    """Annotate each candidate node with the LLM's relevance verdict."""

    # The LLM is injected (and thus mockable); PrivateAttr keeps it off the
    # serialized pydantic model that BaseNodePostprocessor is built on.
    _llm: LLMClient = PrivateAttr()
    _status: str = PrivateAttr(default="ok")
    _fallback_reason: str | None = PrivateAttr(default=None)

    def __init__(self, llm: LLMClient) -> None:
        super().__init__()
        self._llm = llm

    @property
    def status(self) -> str:
        """``ok`` when the LLM judged the list, ``fallback`` when it was kept as is."""
        return self._status

    @property
    def fallback_reason(self) -> str | None:
        """Why the original list was kept, when ``status`` is ``fallback``."""
        return self._fallback_reason

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
        try:
            verdicts = self._judge(new_incident, nodes)
        except Exception as exc:  # noqa: BLE001 - any provider failure degrades, never fails.
            log.warning("postfilter_failed", error=str(exc), error_type=type(exc).__name__)
            verdicts = {}
            self._fallback_reason = f"erro do provedor de IA ({type(exc).__name__})"
        else:
            if not verdicts:
                self._fallback_reason = "resposta sem avaliações válidas"
        if self._fallback_reason is not None:
            self._status = "fallback"
            for node in nodes:
                node.node.metadata["survived"] = True
                node.node.metadata["postfilter_reason"] = FALLBACK_REASON
            return nodes
        for node in nodes:
            number = str(node.node.metadata.get("number", ""))
            relevant, reason = verdicts.get(number, (True, "não avaliado"))
            node.node.metadata["survived"] = relevant
            node.node.metadata["postfilter_reason"] = reason
        # Keep all nodes for transparency, surviving ones first.
        return sorted(nodes, key=lambda node: not node.node.metadata.get("survived", True))

    def _judge(self, new_incident: str, nodes: list[NodeWithScore]) -> dict[str, tuple[bool, str]]:
        """Ask the LLM for a relevance verdict per candidate (one call)."""
        listing = "\n".join(_describe(node) for node in nodes)
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
                    _truthy(item.get("relevant", True)),
                    str(item.get("reason", "")),
                )
        return verdicts


def _clip(text: object, limit: int) -> str:
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _describe(node: NodeWithScore) -> str:
    """One line per candidate with what it is about, not only its title.

    With the title alone the judge dropped the class case's nearest neighbours as
    "sem menção a token ou sessão" while their descriptions said exactly that.
    """
    meta = node.node.metadata
    parts = [_clip(meta.get("short_description"), 160)]
    if meta.get("description"):
        parts.append(f"descrição: {_clip(meta.get('description'), 360)}")
    fix = meta.get("resolution_notes") or meta.get("root_cause")
    if fix:
        parts.append(f"resolução: {_clip(fix, 240)}")
    return f"- {meta.get('number', '')}: " + "; ".join(p for p in parts if p)


def _truthy(value: object) -> bool:
    """bool("false") is True: read what the model meant."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "sim", "1", "yes", "verdadeiro"}
