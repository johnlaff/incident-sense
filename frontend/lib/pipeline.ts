// View model for the incident suggestion pipeline (the seven steps of João's
// article; the procedência gate is step 5). Pure functions, so the screen never
// reads raw wire fields and the mapping is unit-tested.
//
// One vocabulary everywhere (pipeline, Aurora panel, Como funciona):
// 1 Carregar · 2 Resumir · 3 Transformar em números · 4 Buscar e conferir
// (tags, vetor, pós-filtro) · 5 Classificar · 6 Sugerir · 7 Publicar.

import type {
  CitationFlag,
  RecordKind,
  StepId,
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
  incidente: "vieram do próprio incidente",
  ia: "a IA escolheu ao resumir",
  catalogo: "são as usuais da categoria",
  nenhuma: "nenhuma tag reconhecida",
};

/** What happened to one record across layers 2 and 3. */
export type Outcome = "abaixo" | "mantido" | "descartado" | "mantido-fallback";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  abaixo: "pouco parecido",
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

// ---------------------------------------------------------------------------
// The seven steps, one vocabulary
// ---------------------------------------------------------------------------

export type LessonStepKey =
  "carregar" | "resumir" | "numeros" | "buscar" | "classificar" | "sugerir" | "publicar";

export interface StepDef {
  key: LessonStepKey;
  order: number;
  title: string;
  /** What the step is for, shown before (and while) the run. */
  hint: string;
  /** Backend step ids folded into this step ("contexto" closes step 4). */
  sources: StepId[];
  /** Step 5 is the procedência gate. */
  gate?: boolean;
}

export const PIPELINE_STEPS: StepDef[] = [
  {
    key: "carregar",
    order: 1,
    title: "Carregar",
    hint: "Lê o chamado, a categoria e as tags.",
    sources: ["carregar"],
  },
  {
    key: "resumir",
    order: 2,
    title: "Resumir",
    hint: "Resumo curto encontra casos melhores.",
    sources: ["resumir"],
  },
  {
    key: "numeros",
    order: 3,
    title: "Transformar em números",
    hint: "Sentido parecido vira número parecido.",
    sources: ["embedding"],
  },
  {
    key: "buscar",
    order: 4,
    title: "Buscar e conferir",
    hint: "Acha casos resolvidos parecidos. Uma IA confere cada um.",
    sources: ["recuperar", "contexto"],
  },
  {
    key: "classificar",
    order: 5,
    title: "Classificar",
    hint: "Não é falha técnica? Então a IA não sugere nada.",
    sources: ["decidir"],
    gate: true,
  },
  {
    key: "sugerir",
    order: 6,
    title: "Sugerir",
    hint: "A solução cita só os casos encontrados.",
    sources: ["sugerir"],
  },
  {
    key: "publicar",
    order: 7,
    title: "Publicar",
    hint: "Vira nota no incidente. A pessoa analista decide.",
    sources: ["publicar"],
  },
];

export interface StepView extends StepDef {
  status: StepStatus;
  /** What the backend says the step decided (several for step 4). */
  decisions: string[];
}

const STATUS_WEIGHT: Record<StepStatus, number> = {
  concluida: 0,
  pulada: 1,
  degradada: 2,
};

/** The seven steps with the run's status and decisions folded in. */
export function stepViews(res: SuggestResponse): StepView[] {
  return PIPELINE_STEPS.map((def) => {
    const parts = def.sources
      .map((id) => res.steps.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    // A degraded part degrades the step; a step with no part did not run.
    const status = parts.length
      ? parts.reduce<StepStatus>(
          (worst, p) =>
            STATUS_WEIGHT[p.status] > STATUS_WEIGHT[worst] ? p.status : worst,
          "concluida",
        )
      : "pulada";
    return { ...def, status, decisions: parts.map((p) => p.decision) };
  });
}

// ---------------------------------------------------------------------------
// The replay, beat by beat (modo aula captions from motion/direcao.md, 6)
// ---------------------------------------------------------------------------

export type SearchLayer = "tags" | "vetor" | "conferir";

export interface Beat {
  step: LessonStepKey;
  layer?: SearchLayer;
  title: string;
  caption: string;
  counter: string;
}

export const BEATS: Beat[] = [
  {
    step: "carregar",
    title: "Carregar",
    counter: "Etapa 1 de 7",
    caption: "Primeiro a IA lê o chamado: título, descrição, categoria, empresa e tags.",
  },
  {
    step: "resumir",
    title: "Resumir",
    counter: "Etapa 2 de 7",
    caption:
      "O texto do usuário é bagunçado. A IA escreve um resumo curto, e é o resumo que vai para a busca.",
  },
  {
    step: "numeros",
    title: "Transformar em números",
    counter: "Etapa 3 de 7",
    caption:
      "O resumo vira 3072 números. Textos com sentido parecido viram números parecidos.",
  },
  {
    step: "buscar",
    layer: "tags",
    title: "Buscar: tags",
    counter: "Etapa 4 de 7 · tags",
    caption: "Antes de comparar, as tags dizem em que parte do histórico procurar.",
  },
  {
    step: "buscar",
    layer: "vetor",
    title: "Buscar: vetor",
    counter: "Etapa 4 de 7 · vetor",
    caption:
      "Comparamos com o histórico. Quanto mais perto de 1, mais parecido. Abaixo de 0,80 fica de fora.",
  },
  {
    step: "buscar",
    layer: "conferir",
    title: "Conferir",
    counter: "Etapa 4 de 7 · conferir",
    caption:
      "Parecer não basta. Uma IA lê cada candidato e descarta o que não ajuda neste caso.",
  },
  {
    step: "classificar",
    title: "Classificar",
    counter: "Etapa 5 de 7",
    caption:
      "É falha técnica? Se não for, a IA não sugere nada. Saber não responder também é resposta.",
  },
  {
    step: "sugerir",
    title: "Sugerir",
    counter: "Etapa 6 de 7",
    caption:
      "A sugestão só pode citar casos que passaram pela busca. Citação de fora é removida.",
  },
  {
    step: "publicar",
    title: "Publicar",
    counter: "Etapa 7 de 7",
    caption:
      "A sugestão volta para o incidente como nota. Quem decide é a pessoa analista.",
  },
];

/** The 3 in "3072 números" comes from the run when the server reports it. */
export function beatsFor(dims: number | null | undefined, minSimilarity: number): Beat[] {
  return BEATS.map((b) => {
    if (b.step === "numeros" && dims)
      return { ...b, caption: b.caption.replace("3072", dims.toLocaleString("pt-BR")) };
    if (b.layer === "vetor")
      return { ...b, caption: b.caption.replace("0,80", formatSim(minSimilarity)) };
    return b;
  });
}

/** How far the replay got: "hidden" (outline), "current" or "done". */
export type Reveal = "hidden" | "current" | "done";

export function stepReveal(key: LessonStepKey, beat: number): Reveal {
  if (beat < 0) return "hidden";
  const first = BEATS.findIndex((b) => b.step === key);
  let last = first;
  while (last + 1 < BEATS.length && BEATS[last + 1].step === key) last++;
  if (beat < first) return "hidden";
  return beat <= last ? "current" : "done";
}

/** Is a retrieval layer on screen at this beat? */
export function layerShown(layer: SearchLayer, beat: number): boolean {
  const at = BEATS.findIndex((b) => b.layer === layer);
  return beat >= at;
}

/** Words in a text, for "112 palavras → 24 palavras". */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Where a cited id sits in the search, for the citation-to-row link. */
export function citationSource(
  id: string,
  res: SuggestResponse,
): { row: RetrievalRow | null; inContext: boolean } {
  const rows = [...retrievalRows(res, "incidente"), ...retrievalRows(res, "problema")];
  return {
    row: rows.find((r) => r.number === id) ?? null,
    inContext: res.context_ids.includes(id),
  };
}
