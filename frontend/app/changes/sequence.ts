// Pure logic behind the evaluation reveal: the weighted-average segments, the
// formula terms and the explicit list of teaching steps. No React, no DOM, so
// the sequence can be tested and later driven by the "modo aula" step index.
import {
  PARTIAL_FROM,
  isScored,
  type DecisionReason,
  type Evaluation,
  type FieldKey,
  type FieldScore,
  type ScoredField,
  type SemanticAnalysis,
} from "@/lib/changes";

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
 * A field the AI could not judge is left out, like evaluator.py does.
 */
export function weightedSegments(
  all: FieldScore[],
  previous?: FieldScore[] | null,
): WeightedAverage {
  const fields = all.filter(isScored);
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  const before = new Map(previous?.filter(isScored).map((f) => [f.key, f.score]) ?? []);
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
export function fmtDelta(delta: number, places = 1): string {
  if (delta > 0) return `+${fmt(delta, places)}`;
  if (delta < 0) return `−${fmt(-delta, places)}`;
  // "0,0" next to a grade read as a second grade of zero (E2E-3 P2-4).
  return "igual";
}

/** Change of the weighted average, at its two places. */
export function avgDelta(current: number, previous: number): number {
  return Math.round((current - previous) * 100) / 100;
}

/** "9,5 × 2,5" for each field, in order. */
export function formulaTerms(avg: WeightedAverage): string[] {
  return avg.segments.map((s) => `${fmt(s.score)} × ${fmtWeight(s.weight)}`);
}

export type StepId = "notas" | "media" | "portao" | "coerencia" | "problemas";

/** The fields the AI could not judge, by label. */
export function missingFields(ev: Evaluation): string[] {
  return ev.fields.filter((f) => !isScored(f)).map((f) => f.label);
}

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

/** Gate 1 answered yes: every field graded and the average reaches the cut. */
export function gatePassed(ev: Evaluation): boolean {
  const overall = overallOf(ev);
  return overall !== null && overall >= ev.threshold && missingFields(ev).length === 0;
}

/** One of the two questions that decide a change. */
export type GateState = "pass" | "fail" | "skipped";

export interface ChangeDecision {
  /** Pode seguir: both gates pass. */
  ok: boolean;
  /** Which rule decided: the backend's reason_code (or the local one). */
  code: DecisionReason;
  cut: number;
  /**
   * Gate 1: does the weighted average reach the cut? "skipped" when a field
   * has no grade, so the question has no answer yet.
   */
  average: { value: number; state: GateState };
  /**
   * Gate 2: do the parts of the request agree? "skipped" when gate 1 failed
   * (the backend does not run it) or when the analysis did not come back.
   */
  coherence: {
    value: number | null;
    adherence: SemanticAnalysis["backout_adherence"] | null;
    state: GateState;
  };
  /** The gate that holds the change back, if any. */
  failing: "fields" | "average" | "coherence" | null;
  /** Every rule that held it back, in the backend's order; reason_code first. */
  failed: DecisionReason[];
  /** Fields under the cut, lowest first, even when the change may go on. */
  low: ScoredField[];
}

/**
 * The highest average a new reading could still give: a 10 in every field the
 * AI did not grade. Below the cut, the missing grade cannot change the answer.
 */
export function bestAverage(ev: Evaluation): number {
  const total = ev.fields.reduce((sum, f) => sum + f.weight, 0);
  if (total === 0) return 0;
  const sum = ev.fields.reduce(
    (acc, f) => acc + (isScored(f) ? f.score : 10) * f.weight,
    0,
  );
  return round2(sum / total);
}

/** A field is missing and even a 10 there could not lift the average to the cut. */
function unreachable(ev: Evaluation): boolean {
  return missingFields(ev).length > 0 && bestAverage(ev) < ev.threshold;
}

/** Gate 2's failing parts, in the order evaluator.decide names them. */
function localGate2(s: SemanticAnalysis, cut: number): DecisionReason[] {
  const out: DecisionReason[] = [];
  if (Math.round(s.consistency_score * 10) / 10 < cut) out.push("coherence_below");
  if (s.problems.length > 0) out.push("contradictions");
  if (s.backout_adherence === "NAO_ADERENTE") out.push("backout_not_adherent");
  return out;
}

/** The rule of evaluator.decide, for old payloads and fixtures without it. */
function localFailed(ev: Evaluation, value: number): DecisionReason[] {
  if (unreachable(ev)) return ["average_below"];
  if (missingFields(ev).length > 0) return ["field_missing"];
  if (value < ev.threshold) return ["average_below"];
  const s = ev.semantic;
  if (!s) return ["semantic_missing"];
  return localGate2(s, ev.threshold);
}

const GATE2_FAILS: DecisionReason[] = [
  "coherence_below",
  "contradictions",
  "backout_not_adherent",
];

/**
 * The one rule every view reads (banner, list, aula captions, tests), as the
 * backend's decision.reason_code says: every field graded, average >= cut,
 * coherence >= cut, no real contradiction listed and the back-out plan undoes
 * at least 50% of the tasks. The local rule only reads old payloads.
 */
export function decisionOf(ev: Evaluation): ChangeDecision | null {
  const value = overallOf(ev);
  if (value === null) return null;
  const cut = ev.threshold;
  const low = ev.fields
    .filter(isScored)
    .filter((f) => f.score < cut)
    .sort((a, b) => a.score - b.score);
  const s = ev.semantic;
  const failed: DecisionReason[] = ev.decision
    ? (ev.decision.failed ??
      (ev.decision.passes
        ? []
        : GATE2_FAILS.includes(ev.decision.reason_code) && s
          ? localGate2(s, cut)
          : [ev.decision.reason_code]))
    : localFailed(ev, value);
  const code: DecisionReason = ev.decision?.reason_code ?? failed[0] ?? "passes";
  const ok = ev.decision ? ev.decision.passes : code === "passes";
  const avgState: GateState =
    code === "field_missing" ? "skipped" : code === "average_below" ? "fail" : "pass";
  const avgOk = avgState === "pass";
  const coh = s ? Math.round(s.consistency_score * 10) / 10 : null;
  const state: GateState =
    !avgOk || !s
      ? "skipped"
      : ok
        ? "pass"
        : GATE2_FAILS.includes(code)
          ? "fail"
          : "skipped";
  const failing = ok
    ? null
    : code === "field_missing"
      ? "fields"
      : !avgOk
        ? "average"
        : "coherence";
  return {
    ok,
    code,
    cut,
    average: { value, state: avgState },
    coherence: {
      value: avgOk && s ? coh : null,
      adherence: avgOk && s ? s.backout_adherence : null,
      state,
    },
    failing,
    failed: ok ? [] : failed.length > 0 ? failed : [code],
    low,
  };
}

export interface ChangeVerdict {
  /** May go on to a person's approval. */
  ok: boolean;
  /** "Pode seguir" or "Não segue". */
  title: string;
  /** One plain line with the reason. */
  reason: string;
}

function lowNote(low: ScoredField[], cut: number): string {
  if (low.length === 0) return "";
  const named = low
    .slice(0, 2)
    .map((f) => `${f.label} (${fmt(f.score)})`)
    .join(" e ");
  const more = low.length > 2 ? ` e mais ${low.length - 2}` : "";
  return low.length === 1
    ? ` Um campo ficou abaixo de ${fmt(cut)}: ${named}. Vale melhorar, mas não impede.`
    : ` ${low.length} campos ficaram abaixo de ${fmt(cut)}: ${named}${more}. Vale melhorar, mas não impedem.`;
}

/** The same sentences as evaluator.decide, for payloads without a decision. */
function localReason(ev: Evaluation, d: ChangeDecision): string {
  const avg = fmt(d.average.value, 2);
  const cut = fmt(d.cut);
  const coh = d.coherence.value === null ? "" : fmt(d.coherence.value);
  const s = ev.semantic;
  switch (d.code) {
    case "field_missing": {
      const names = missingFields(ev).join(", ");
      return `A IA não conseguiu avaliar ${missingFields(ev).length === 1 ? "o campo" : "os campos"} ${names}. Sem essa nota não há veredito: avalie de novo.`;
    }
    case "average_below":
      return missingFields(ev).length > 0
        ? `Mesmo com nota 10 em ${missingFields(ev).join(", ")}, a média chegaria no máximo a ${fmt(bestAverage(ev), 2)}, abaixo do mínimo de ${cut}.`
        : `A média ficou em ${avg}, abaixo do mínimo de ${cut}.`;
    case "semantic_missing": {
      const { why, again } = semanticCause(ev);
      return `A média passou do mínimo (${avg}), mas a conferência das partes do pedido não voltou: ${why}. ${again}`;
    }
    case "passes":
      return `Média ${avg} e coerência ${coh}, as duas a partir de ${cut}.`;
    default: {
      // Gate 2: every part that fails, joined like evaluator.decide.
      const parts = d.failed.map((code) =>
        code === "coherence_below"
          ? `as partes do pedido não combinam: coerência ${coh}, abaixo de ${cut}`
          : code === "contradictions"
            ? `a IA encontrou ${contradictions(s?.problems.length ?? 0)} entre as partes do pedido`
            : `o plano de retorno desfaz só ${s?.backout_adherence_percent ?? 0}% do que as tarefas fazem (abaixo de ${PARTIAL_FROM}% a mudança não segue)`,
      );
      const lead = d.failed.includes("coherence_below")
        ? `A média passou (${avg}), mas `
        : `A média (${avg}) e a coerência (${coh}) passaram, mas `;
      const joined =
        parts.length === 1
          ? parts[0]
          : `${parts.slice(0, -1).join("; ")}; e ${parts.at(-1)}`;
      return `${lead}${joined}.`;
    }
  }
}

function contradictions(n: number): string {
  return `${n} ${n === 1 ? "contradição" : "contradições"}`;
}

/** Why the coherence check did not come back, in the backend's own words. */
const SEMANTIC_WHY = {
  timeout: "a IA demorou demais para responder",
  quota: "a IA está sem cota agora",
  format: "a IA não respondeu no formato esperado",
} as const;

/**
 * The cause of a coherence check that did not come back, read from the
 * backend's semantic_skipped_reason (timeout, no quota or an odd reply), and
 * what to do about it.
 */
export function semanticCause(ev: Evaluation): { why: string; again: string } {
  const said = ev.semantic_skipped_reason ?? "";
  const kind = said.includes("demorou demais")
    ? "timeout"
    : said.includes("sem cota")
      ? "quota"
      : "format";
  return {
    why: SEMANTIC_WHY[kind],
    again: kind === "quota" ? "Tente de novo mais tarde." : "Avalie de novo.",
  };
}

/**
 * Gate 2's answer on the banner: the number that failed. A contradiction or a
 * short back-out plan is not a low coherence, so it is not shown as one.
 */
export function gate2Value(ev: Evaluation, d: ChangeDecision): string | null {
  const s = ev.semantic;
  if (d.coherence.value === null || !s) return null;
  if (d.coherence.state !== "fail" || d.failed.includes("coherence_below"))
    return fmt(d.coherence.value);
  if (d.failed.includes("contradictions")) return contradictions(s.problems.length);
  return `${s.backout_adherence_percent}%`;
}

/** Gate 2's note on the banner: every part that failed, or why it was not asked. */
export function gate2Note(ev: Evaluation, d: ChangeDecision): string {
  const cut = fmt(d.cut);
  const s = ev.semantic;
  if (d.coherence.state === "skipped") {
    if (d.code !== "semantic_missing") return "Só é perguntado quando a 1 passa.";
    const { why, again } = semanticCause(ev);
    return `A conferência não voltou: ${why}. ${again}`;
  }
  if (d.coherence.state === "pass") return `Coerência de 0 a 10, mesmo corte de ${cut}.`;
  return d.failed
    .map((code) =>
      code === "coherence_below"
        ? `Coerência ${fmt(d.coherence.value ?? 0)}, abaixo de ${cut}.`
        : code === "contradictions"
          ? `A IA encontrou ${contradictions(s?.problems.length ?? 0)} entre as partes do pedido.`
          : `O plano de retorno desfaz só ${s?.backout_adherence_percent ?? 0}% das tarefas; o mínimo é ${PARTIAL_FROM}%.`,
    )
    .join(" ");
}

/**
 * The answer of the whole reading, in words. The reason is the backend's own
 * sentence, so the banner, the list and the API never word it twice.
 */
export function verdictOf(ev: Evaluation): ChangeVerdict | null {
  const d = decisionOf(ev);
  if (!d) return null;
  const reason = ev.decision?.reason ?? localReason(ev, d);
  if (d.ok) {
    return {
      ok: true,
      title: "Pode seguir",
      reason: `${reason}${lowNote(d.low, d.cut)}`,
    };
  }
  const again = d.code === "semantic_missing" || d.code === "field_missing";
  return { ok: false, title: again ? "Não segue ainda" : "Não segue", reason };
}

/**
 * What the coherence card and the last aula step say about gate 2, from the
 * decision's reason_code. One wording for both, so they never disagree.
 */
export function coherenceNote(ev: Evaluation): { title: string; line: string } | null {
  const d = decisionOf(ev);
  if (!d) return null;
  const cut = fmt(d.cut);
  const s = ev.semantic;
  switch (d.code) {
    case "field_missing":
      return {
        title: "Não conferida",
        line: `Não conferida: falta a nota de ${missingFields(ev).join(", ")}. Avalie de novo.`,
      };
    case "average_below":
      return {
        title: "Não conferida",
        line: "Não conferida: ela só é conferida quando a média chega ao mínimo.",
      };
    case "semantic_missing": {
      const { why, again } = semanticCause(ev);
      return { title: "Não conferida", line: `Não conferida: ${why}. ${again}` };
    }
    case "contradictions":
      return {
        title: "Onde as partes se contradizem",
        line: "Cada ponto é uma contradição entre as partes do pedido. Com uma só, a mudança não segue.",
      };
    case "backout_not_adherent":
      return {
        title: "O plano de retorno não cobre as tarefas",
        line: `A coerência passou (${fmt(s?.consistency_score ?? 0)}), mas o plano de retorno desfaz só ${s?.backout_adherence_percent ?? 0}% do que as tarefas fazem; abaixo de ${PARTIAL_FROM}% a mudança não segue.`,
      };
    case "coherence_below":
      return {
        title: "Onde as partes não combinam",
        line:
          s && s.problems.length > 0
            ? "Cada ponto é um lugar em que as partes do pedido contam histórias diferentes."
            : `A nota de coerência ficou abaixo de ${cut}: as partes do pedido não contam a mesma história.`,
      };
    default:
      return {
        title: "Nada se contradiz",
        line: "Nada se contradiz: as partes do pedido contam a mesma história.",
      };
  }
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
  const d = decisionOf(ev);
  const missing = missingFields(ev);

  // Fields sent again only because the AI had not graded them last time.
  const ungraded = new Set(
    previous?.fields.filter((f) => !isScored(f)).map((f) => f.key),
  );
  const sent = ev.fields.filter((f) => !f.reused);
  const retried = sent.filter((f) => ungraded.has(f.key)).length;
  const notas =
    reused === n
      ? previous
        ? "Nada mudou desde a última avaliação: as notas foram reaproveitadas, sem chamar a IA."
        : "Este navegador já tinha avaliado este texto: as notas foram reaproveitadas, sem chamar a IA."
      : reused > 0 && retried === sent.length
        ? retried === 1
          ? "O campo que a IA não tinha avaliado voltou para ela; os outros foram reaproveitados."
          : "Os campos que a IA não tinha avaliado voltaram para ela; os outros foram reaproveitados."
        : reused > 0 && retried > 0
          ? "Voltaram para a IA os campos com texto novo e os que ela não tinha avaliado. Os outros foram reaproveitados."
          : reused > 0
            ? "Só os campos com texto novo voltaram para a IA. Os outros foram reaproveitados, porque o texto não mudou."
            : "Uma IA juíza dá nota de 0 a 10 a cada campo, sempre com os mesmos critérios.";
  const steps: Step[] = [
    {
      id: "notas",
      title: "Nota de cada campo",
      caption: notas,
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
      caption:
        missing.length > 0 && d?.code === "average_below"
          ? `Pergunta 1 de 2: mesmo com nota 10 em ${missing.join(", ")}, a média chegaria no máximo a ${fmt(bestAverage(ev), 2)}, abaixo de ${cut}. Não segue.`
          : missing.length > 0
            ? `Pergunta 1 de 2 fica sem resposta: a IA não conseguiu avaliar ${missing.join(", ")}. Não segue ainda: avalie de novo.`
            : passed
              ? `Pergunta 1 de 2: a média (${fmt(overallOf(ev) ?? 0, 2)}) passou do mínimo de ${cut}. Agora a IA confere se os campos contam a mesma história.`
              : `Pergunta 1 de 2: a média ficou abaixo de ${cut}. Não segue, e a pergunta 2 nem é feita.`,
      ms: t.explain + t.hold * 2,
    },
  ];

  if (passed && !ev.semantic) {
    // The check did not come back: the lesson still ends on a verdict.
    const { why, again } = semanticCause(ev);
    steps.push({
      id: "coerencia",
      title: "Coerência entre os campos",
      caption: `Pergunta 2 de 2 não voltou: ${why}. Não segue ainda: ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
      ms: t.explain + t.hold * 2,
    });
  }
  if (passed && ev.semantic) {
    const s = ev.semantic;
    const note = coherenceNote(ev)!;
    steps.push(
      {
        id: "coerencia",
        title: "Coerência entre os campos",
        caption: `Pergunta 2 de 2: os campos contam a mesma história? Nota de coerência, corte de ${cut}; o retorno desfaz ${s.backout_adherence_percent}% das tarefas.`,
        ms: t.explain + t.count + t.hold,
      },
      {
        id: "problemas",
        title: d?.ok ? "As partes combinam" : note.title,
        caption: note.line,
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

// ----- Re-evaluation words ----------------------------------------------------

interface Rerun {
  /** Fields edited since the last result. */
  dirty: number;
  /** Fields the last result has no grade for and nobody edited: they go back too. */
  failed?: number;
  /** The model differs from the one that read the last result. */
  modelChanged: boolean;
  total: number;
}

/** How many fields the next run sends to the model (the content lock). */
export function sentFields({
  dirty,
  failed = 0,
  modelChanged,
  total,
  first,
}: Rerun & { first: boolean }) {
  if (first || modelChanged) return total;
  return dirty + failed;
}

/**
 * The edited set after saving one field: a text back to the one the result
 * was read with is no edit, so that field leaves the set (bugs-logica-3 P2-8).
 */
export function nextDirty(
  dirty: Set<FieldKey>,
  key: FieldKey,
  next: string,
  readText: string,
): Set<FieldKey> {
  const out = new Set(dirty);
  if (next === readText) out.delete(key);
  else out.add(key);
  return out;
}

/**
 * The line under the button while the evaluation runs. ``mayReuse``: this tab
 * has no result yet, but the server may hold this browser's earlier reading
 * of the same text, so a fresh reading is not promised.
 */
export function runningLine(
  fields: number,
  { mayReuse = false }: { mayReuse?: boolean } = {},
): string {
  if (fields === 0) return "Conferindo se algo mudou desde a última avaliação.";
  if (mayReuse)
    return "Enviando os campos para a IA, no servidor. Texto que este navegador já avaliou volta reaproveitado.";
  if (fields === 1)
    return "A IA está lendo o campo que mudou, no servidor. Os outros são reaproveitados.";
  return `A IA está lendo os ${fields} campos em paralelo, no servidor. As notas chegam todas juntas.`;
}

/** What the next "Reavaliar" will send, said before it runs. */
export function rerunHint({
  dirty,
  failed = 0,
  modelChanged,
  total,
}: Rerun): string | null {
  if (modelChanged) return `Modelo trocado: os ${total} campos voltam para a IA.`;
  if (dirty === 0 && failed > 0)
    return failed === 1
      ? "O campo que a IA não tinha avaliado volta para ela; os outros são reaproveitados."
      : `Os ${failed} campos que a IA não tinha avaliado voltam para ela; os outros são reaproveitados.`;
  if (dirty === 0) return null;
  return dirty === 1
    ? "1 campo mudou. Só ele volta para a IA; os outros são reaproveitados, porque o texto não mudou."
    : `${dirty} campos mudaram. Só eles voltam para a IA; os outros são reaproveitados, porque o texto não mudou.`;
}
