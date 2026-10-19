// View model for the incident suggestion pipeline (the seven steps of João's
// article plus the procedência gate). Pure functions, so the screen never reads
// raw wire fields and the mapping is unit-tested.

import type {
  CitationFlag,
  PipelineStep,
  RecordKind,
  StepStatus,
  SuggestResponse,
  TagLayer,
  WorkNote,
} from "./types";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  concluida: "Concluída",
  pulada: "Não se aplica",
  degradada: "Com contorno",
};

export const TAG_SOURCE_LABEL: Record<TagLayer["source"], string> = {
  incidente: "tags do próprio incidente",
  ia: "tags escolhidas pela IA no resumo",
  catalogo: "tags usuais da categoria e subcategoria",
  nenhuma: "nenhuma tag reconhecida",
};

/** What happened to one record across layers 2 and 3. */
export type Outcome = "abaixo" | "mantido" | "descartado" | "mantido-fallback";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  abaixo: "abaixo do limiar",
  mantido: "mantido",
  descartado: "descartado",
  "mantido-fallback": "mantido (lista original)",
};

export interface RetrievalRow {
  number: string;
  kind: RecordKind;
  desc: string;
  sim: number;
  outcome: Outcome;
  /** The post-filter's reason, when the record reached layer 3. */
  reason: string | null;
}

/** Merge the vector hits with the post-filter verdicts, one row per record. */
export function retrievalRows(res: SuggestResponse, kind: RecordKind): RetrievalRow[] {
  const { vector, postfilter } = res.retrieval;
  const verdicts = new Map(postfilter.verdicts.map((v) => [v.number, v]));
  const hits = kind === "incidente" ? vector.incidents : vector.problems;
  return hits.map((hit) => {
    const verdict = verdicts.get(hit.number);
    let outcome: Outcome;
    if (!hit.passed || !verdict) outcome = "abaixo";
    else if (!verdict.kept) outcome = "descartado";
    else outcome = postfilter.status === "fallback" ? "mantido-fallback" : "mantido";
    return {
      number: hit.number,
      kind,
      desc: hit.short_description,
      sim: hit.similarity,
      outcome,
      reason: hit.passed && verdict ? verdict.reason : null,
    };
  });
}

export interface LayerCounts {
  passed: number;
  total: number;
  kept: number;
  dropped: number;
}

export function layerCounts(rows: RetrievalRow[]): LayerCounts {
  const passed = rows.filter((r) => r.outcome !== "abaixo").length;
  const kept = rows.filter(
    (r) => r.outcome === "mantido" || r.outcome === "mantido-fallback",
  ).length;
  return { passed, total: rows.length, kept, dropped: passed - kept };
}

/** The numbered steps (1 to 7) and the gate, in the article's order. */
export function orderedSteps(res: SuggestResponse): PipelineStep[] {
  return [...res.steps].sort(
    (a, b) => a.order - b.order || Number(a.gate) - Number(b.gate),
  );
}

/** Short label for a step's position: "1" ... "7", or "?" for the gate. */
export function stepMarker(step: PipelineStep): string {
  return step.gate ? "?" : String(step.order);
}

export function citationSummary(flags: CitationFlag[]): string {
  if (!flags.length) return "Todas as citações estão no contexto recuperado.";
  const removed = flags.filter((f) => f.action === "removida").length;
  const marked = flags.length - removed;
  const parts: string[] = [];
  if (removed) parts.push(`${removed} ${removed === 1 ? "removida" : "removidas"}`);
  if (marked) parts.push(`${marked} ${marked === 1 ? "sinalizada" : "sinalizadas"}`);
  const total = flags.length;
  return `${total} ${total === 1 ? "citação fora" : "citações fora"} do contexto: ${parts.join(" e ")}.`;
}

/** Add a freshly published note to the ones loaded with the incident (no dupes). */
export function mergeNotes(
  loaded: WorkNote[],
  fresh: WorkNote | null | undefined,
): WorkNote[] {
  if (!fresh || loaded.some((n) => n.id === fresh.id)) return loaded;
  return [...loaded, fresh];
}

export interface StepOutline {
  id: PipelineStep["id"];
  order: number;
  gate: boolean;
  title: string;
  hint: string;
}

/** The pipeline before (or while) it runs: what each step is for. */
export const STEP_OUTLINE: StepOutline[] = [
  {
    id: "carregar",
    order: 1,
    gate: false,
    title: "Carregar o incidente",
    hint: "O registro é lido da base, com categoria, subcategoria, empresa e tags.",
  },
  {
    id: "resumir",
    order: 2,
    gate: false,
    title: "Resumo por IA",
    hint: "A IA resume o chamado. O resumo, nunca o texto cru, vira a consulta.",
  },
  {
    id: "embedding",
    order: 3,
    gate: false,
    title: "Embedding do resumo",
    hint: "Resumo, categoria, subcategoria e empresa viram um único vetor.",
  },
  {
    id: "recuperar",
    order: 4,
    gate: false,
    title: "Recuperação em três camadas",
    hint: "Tags decidem onde procurar, o vetor mede o que parece e o LLM filtra o que serve.",
  },
  {
    id: "contexto",
    order: 5,
    gate: false,
    title: "Contexto de casos semelhantes",
    hint: "Incidentes e problemas que passaram pelas três camadas formam o contexto.",
  },
  {
    id: "decidir",
    order: 5,
    gate: true,
    title: "Incidente procedente?",
    hint: "Se não for falha técnica, não há sugestão: classificar sem propor também é resposta.",
  },
  {
    id: "sugerir",
    order: 6,
    gate: false,
    title: "Sugestão com fontes",
    hint: "A resposta cita as fontes; citações fora do contexto são removidas ou sinalizadas.",
  },
  {
    id: "publicar",
    order: 7,
    gate: false,
    title: "Publicação no incidente",
    hint: "A sugestão volta para as notas de trabalho do incidente.",
  },
];

/** Similarity with a PT-BR decimal comma, truncated to two places ("0,84").
 *
 * Truncated, not rounded: a 0.7999 hit must not read "0,80" next to an
 * "abaixo do limiar" pill when the floor is 0,8. */
export function formatSim(value: number): string {
  const truncated = Math.floor(value * 100 + 1e-9) / 100;
  return truncated.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
