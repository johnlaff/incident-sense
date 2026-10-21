// Pure logic behind the evaluation reveal: the weighted-average segments, the
// formula terms and the explicit list of teaching steps. No React, no DOM, so
// the sequence can be tested and later driven by the "modo aula" step index.
import type { Evaluation, FieldKey, FieldScore } from "@/lib/changes";

/** Base timings in ms, before --motion-scale. They mirror the motion tokens. */
export interface Timing {
  /** --stagger-explain: gap between two field counters. */
  stagger: number;
  /** --dur-count: one counter from start to final value. */
  count: number;
  /** --dur-explain: one teaching visual (bar segment, gate, meter). */
  explain: number;
  /** Gap between two formula terms, slow enough to read each one. */
  term: number;
  /** Gap between two problems in the coherence list. */
  problem: number;
  /** Pause after a step settles, so the eye can catch up. */
  hold: number;
}

export const DEFAULT_TIMING: Timing = {
  stagger: 90,
  count: 600,
  explain: 560,
  term: 270,
  problem: 260,
  hold: 450,
};

export interface Segment {
  key: FieldKey;
  label: string;
  score: number;
  weight: number;
  /** score x weight, the numerator term. */
  product: number;
  /** product / total weight: how much of the 0-10 bar this field fills. */
  contribution: number;
  /** Where the segment begins on the 0-10 bar. */
  start: number;
  /** Where it ends (start + contribution). */
  end: number;
  reused: boolean;
  /** Score change against the previous evaluation, or null on a first run. */
  delta: number | null;
}

export interface WeightedAverage {
  segments: Segment[];
  totalWeight: number;
  numerator: number;
  /** numerator / totalWeight; equals the API's overall up to its rounding. */
  average: number;
}

/** Round to one decimal, avoiding -0 and float noise like 1.2000000002. */
export function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/** Change in a field's score since the previous evaluation. */
export function scoreDelta(current: number, previous: number | undefined): number | null {
  if (previous === undefined) return null;
  return round1(current - previous);
}

/**
 * Lay the fields end to end on a 0-10 bar. Each field fills
 * score x weight / sum(weights), so the bar's end is the weighted average.
 */
export function weightedSegments(
  fields: FieldScore[],
  previous?: FieldScore[] | null,
): WeightedAverage {
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  const before = new Map(previous?.map((f) => [f.key, f.score]) ?? []);
  let cursor = 0;
  let numerator = 0;
  const segments = fields.map((f) => {
    const product = f.score * f.weight;
    const contribution = totalWeight > 0 ? product / totalWeight : 0;
    const start = cursor;
    cursor += contribution;
    numerator += product;
    return {
      key: f.key,
      label: f.label,
      score: f.score,
      weight: f.weight,
      product,
      contribution,
      start,
      end: cursor,
      reused: f.reused,
      delta: scoreDelta(f.score, before.get(f.key)),
    };
  });
  return {
    segments,
    totalWeight,
    numerator,
    average: totalWeight > 0 ? numerator / totalWeight : 0,
  };
}

/** Brazilian decimal comma with a fixed number of places. */
export function fmt(n: number, places = 1): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Weight without a useless ",0": 2.5 -> "2,5", 2 -> "2". */
export function fmtWeight(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** Signed delta for display: +1,2 / −0,4 / 0,0. Uses the minus sign U+2212. */
export function fmtDelta(delta: number): string {
  if (delta > 0) return `+${fmt(delta)}`;
  if (delta < 0) return `−${fmt(-delta)}`;
  return fmt(0);
}

/** "9,5 × 2,5" for each field, in order. */
export function formulaTerms(avg: WeightedAverage): string[] {
  return avg.segments.map((s) => `${fmt(s.score)} × ${fmtWeight(s.weight)}`);
}

export type StepId = "notas" | "media" | "portao" | "coerencia" | "problemas";

export interface Step {
  id: StepId;
  /** Short name for "Etapa 2 de 5: Média ponderada". */
  title: string;
  /** One plain sentence that teaches what this step shows (the aula caption). */
  caption: string;
  /** How long this step plays before the next one, before --motion-scale. */
  ms: number;
}

/** Round to two places, the way evaluator.py rounds the overall grade. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The one overall grade every view shows: the weighted average of the field
 * scores and weights the API sent, rounded like evaluator.py. Headline, bar,
 * formula and the 8,0 gate all read this, so they can never disagree.
 */
export function overallOf(ev: Evaluation): number | null {
  // null is the backend saying "not graded" (out of scope); keep it.
  if (ev.overall === null || ev.fields.length === 0) return ev.overall;
  return round2(weightedSegments(ev.fields).average);
}

export function gatePassed(ev: Evaluation): boolean {
  const overall = overallOf(ev);
  return overall !== null && overall >= ev.threshold;
}

export interface ChangeVerdict {
  /** May go on to a person's approval. */
  ok: boolean;
  /** "Pode seguir" or "Não segue". */
  title: string;
  /** One plain line with the reason. */
  reason: string;
}

/**
 * The answer of the whole reading, in words. The rubric only has the
 * weighted-average cut; past it, any inconsistency the AI points out holds the
 * change back until the author fixes it.
 */
export function verdictOf(ev: Evaluation): ChangeVerdict | null {
  const overall = overallOf(ev);
  if (overall === null) return null;
  const avg = fmt(overall, 2);
  const cut = fmt(ev.threshold);
  if (!gatePassed(ev)) {
    return {
      ok: false,
      title: "Não segue",
      reason: `A média ficou em ${avg}, abaixo do mínimo de ${cut}.`,
    };
  }
  if (ev.semantic === null) {
    return {
      ok: false,
      title: "Não segue ainda",
      reason: `A média passou do mínimo (${avg}), mas a conferência de coerência não rodou. Avalie de novo.`,
    };
  }
  const n = ev.semantic.problems.length;
  if (n > 0) {
    return {
      ok: false,
      title: "Não segue",
      reason: `A média passou do mínimo (${avg}), mas a IA achou ${
        n === 1 ? "1 incoerência" : `${n} incoerências`
      } entre os campos.`,
    };
  }
  return {
    ok: true,
    title: "Pode seguir",
    reason: `Média ${avg}, acima do mínimo de ${cut}, e nenhuma incoerência entre os campos.`,
  };
}

/** The first sentence of a longer text, for a one-line "why". */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

/**
 * The teaching sequence for one evaluation, in order. The coherence steps
 * exist only when the backend actually ran the semantic analysis.
 */
export function buildSteps(
  ev: Evaluation,
  previous?: Evaluation | null,
  t: Timing = DEFAULT_TIMING,
): Step[] {
  if (overallOf(ev) === null || ev.fields.length === 0) return [];
  const n = ev.fields.length;
  const cut = fmt(ev.threshold);
  const reused = ev.fields.filter((f) => f.reused).length;
  const passed = gatePassed(ev);

  const steps: Step[] = [
    {
      id: "notas",
      title: "Nota de cada campo",
      caption:
        previous && reused > 0
          ? "Só os campos editados voltaram para a IA. Os outros foram reaproveitados, porque o texto não mudou."
          : "Uma IA juíza dá nota de 0 a 10 a cada campo, sempre com os mesmos critérios.",
      ms: (n - 1) * t.stagger + t.count + t.hold,
    },
    {
      id: "media",
      title: "Média ponderada",
      caption:
        "Campos mais importantes pesam mais. A média ponderada junta tudo numa nota só.",
      ms: (n - 1) * t.term + t.explain * 2 + t.hold,
    },
    {
      id: "portao",
      title: `Corte de ${cut}`,
      caption: passed
        ? `Com ${cut} ou mais a porta abre e a IA confere se os campos contam a mesma história.`
        : "Abaixo do corte: a análise de coerência não roda.",
      ms: t.explain + t.hold * 2,
    },
  ];

  if (passed && ev.semantic) {
    const s = ev.semantic;
    steps.push(
      {
        id: "coerencia",
        title: "Coerência entre os campos",
        caption: `A IA lê os campos juntos. O plano de retorno precisa desfazer o que as tarefas fazem: pela leitura dela, cobre ${s.backout_adherence_percent}%.`,
        ms: t.explain + t.count + t.hold,
      },
      {
        id: "problemas",
        title: "Incoerências",
        caption:
          s.problems.length > 0
            ? "Cada incoerência é um ponto em que os campos contam histórias diferentes."
            : "Nenhuma incoerência apontada: os campos contam a mesma história.",
        ms: Math.max(1, s.problems.length) * t.problem + t.hold,
      },
    );
  }
  return steps;
}

/** True once the playback index has reached (or passed) the step `id`. */
export function reached(steps: Step[], index: number, id: StepId): boolean {
  const at = steps.findIndex((s) => s.id === id);
  return at !== -1 && index >= at;
}

/** Parse a CSS time token ("90ms", "0.56s") into ms; fallback when empty. */
export function parseTime(value: string | null | undefined, fallback: number): number {
  const v = (value ?? "").trim();
  if (!v) return fallback;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return fallback;
  if (v.endsWith("ms")) return n;
  if (v.endsWith("s")) return n * 1000;
  return n;
}
