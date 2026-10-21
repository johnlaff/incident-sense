// The AI answer, read for a person in a hurry: one sentence, up to five
// numbered steps, and the records each step stands on. The model writes
// markdown ("cause sentence [PRB…]" then "1. **Ação**: texto [INC…]"); this
// turns it into blocks. When the text does not fit that shape, the caller
// falls back to the markdown as written.
import { enforceNumberedSteps, normalizeSuggestionSpacing } from "./model";
import type { SuggestResponse } from "./types";

export const MAX_STEPS = 5;

// One id per bracket, or several split by commas: "[INC0052180, PRB0004105]".
const ID = String.raw`(?:INC|PRB)\d{4,}`;
const CITE = new RegExp(String.raw`\[(${ID}(?:\s*,\s*${ID})*)\]`, "g");
const CITE_RUN = new RegExp(
  String.raw`\s*\[${ID}(?:\s*,\s*${ID})*\](?:\s*,\s*\[${ID}(?:\s*,\s*${ID})*\])*`,
  "g",
);
const STEP = /^\s*\d+[.)]\s+/;

export interface AnswerStep {
  title: string | null;
  text: string;
  cites: string[];
}

export interface ParsedAnswer {
  oneLine: string;
  oneLineCites: string[];
  steps: AnswerStep[];
  /** Steps beyond MAX_STEPS, kept out of the card. */
  more: number;
}

function cites(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CITE))
    for (const id of m[1].split(/\s*,\s*/)) if (!out.includes(id)) out.push(id);
  return out;
}

function stripCites(text: string): string {
  return text
    .replace(CITE_RUN, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

/** Split the suggestion into the sentence, the steps and their sources. */
export function parseSuggestion(raw: string): ParsedAnswer | null {
  const md = enforceNumberedSteps(normalizeSuggestionSpacing(raw.trim()));
  const blocks = md
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const first = blocks.findIndex((b) => !STEP.test(b));
  const stepBlocks = blocks.filter((b) => STEP.test(b));
  if (first < 0 || stepBlocks.length === 0) return null;
  const head = blocks[first];
  const steps = stepBlocks.map((b) => {
    const body = b.replace(STEP, "");
    const m = body.match(/^\*\*(.+?)\*\*\s*:?\s*([\s\S]*)$/);
    const title = m ? stripCites(m[1]).replace(/:$/, "") : null;
    const text = stripCites(m ? m[2] : body);
    return { title, text, cites: cites(body) };
  });
  return {
    oneLine: stripCites(head.replace(/^\*\*Provável causa:?\*\*\s*/i, "")),
    oneLineCites: cites(head),
    steps: steps.slice(0, MAX_STEPS),
    more: Math.max(0, steps.length - MAX_STEPS),
  };
}

export type ConfidenceLevel = "alta" | "media" | "baixa";

export interface Confidence {
  level: ConfidenceLevel;
  /** The level in words: what the answer stands on. */
  label: string;
}

/** Three levels in words, from what the answer actually cites. */
export function confidenceOf(res: SuggestResponse): Confidence {
  const cited = res.citations.cited;
  if (!res.suggestion || cited.length === 0)
    return { level: "baixa", label: "Sem evidência suficiente" };
  const keptProblem = res.problems.some(
    (p) => p.survived_postfilter && cited.includes(p.number),
  );
  if (keptProblem)
    return { level: "alta", label: "Sustentado por um Problema conhecido" };
  return { level: "media", label: "Padrão parecido com casos resolvidos" };
}

/** How many records cleared the similarity floor, per kind. */
export function analysedCounts(res: SuggestResponse): {
  incidents: number;
  problems: number;
} {
  const v = res.retrieval.vector;
  return {
    incidents: v.incidents.filter((h) => h.passed).length,
    problems: v.problems.filter((h) => h.passed).length,
  };
}

/** The closest record of all, for the "nothing similar enough" state. */
export function closestHit(
  res: SuggestResponse,
): { number: string; similarity: number } | null {
  const all = [...res.retrieval.vector.incidents, ...res.retrieval.vector.problems];
  if (!all.length) return null;
  const best = all.reduce((a, b) => (b.similarity > a.similarity ? b : a));
  return { number: best.number, similarity: best.similarity };
}

/** The exact text the AI had for one record, and how similar it was. */
export function sourceExcerpt(
  id: string,
  res: SuggestResponse,
): {
  title: string;
  similarity: number | null;
  parts: { label: string; text: string }[];
  reason: string | null;
} | null {
  const inc = res.candidates.find((c) => c.number === id);
  if (inc) {
    return {
      title: inc.short_description,
      similarity: inc.similarity,
      parts: inc.resolution_notes
        ? [{ label: "Como foi resolvido", text: inc.resolution_notes }]
        : [],
      reason: inc.postfilter_reason ?? null,
    };
  }
  const prb = res.problems.find((p) => p.number === id);
  if (prb) {
    return {
      title: prb.short_description,
      similarity: prb.similarity,
      parts: [
        { label: "Causa raiz", text: prb.root_cause },
        { label: "Contorno", text: prb.workaround },
        { label: "Correção definitiva", text: prb.permanent_fix },
      ].filter((p) => p.text),
      reason: prb.postfilter_reason ?? null,
    };
  }
  return null;
}

/** Plain text of the answer, for Copiar and the resolution note. */
export function answerPlain(a: ParsedAnswer): string {
  const steps = a.steps.map(
    (s, i) => `${i + 1}. ${s.title ? `${s.title}: ` : ""}${s.text}`,
  );
  return [a.oneLine, "", ...steps].join("\n");
}

/**
 * A step in two layers: the plain action to read first (its bold title, or
 * the first sentence when it has none) and the technical rest, shown on
 * request ("Ler o texto técnico").
 */
export function stepLayers(step: AnswerStep): { lead: string; rest: string } {
  if (step.title) return { lead: step.title, rest: step.text.trim() };
  const t = step.text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const lead = (m ? m[0] : t).trim();
  return { lead, rest: t.slice(lead.length).trim() };
}

export type EmptyKind = "improcedente" | "rejected" | "below" | "unwritten";

/**
 * Why the card has no suggestion, in one line. "rejected" (cases passed the
 * similarity floor and the AI ruled each one out) and "below" (none passed)
 * are different stories; a customer request carries no confidence badge.
 */
export function emptyAnswer(res: SuggestResponse): {
  kind: EmptyKind;
  line: string;
  confidence: boolean;
} {
  if (res.classification !== "PROCEDENTE")
    return {
      kind: "improcedente",
      line: "Não é uma falha técnica: é um pedido do cliente.",
      confidence: false,
    };
  if (res.context_ids.length > 0)
    return {
      kind: "unwritten",
      line: "A IA achou casos que servem, mas não escreveu a sugestão desta vez.",
      confidence: true,
    };
  const verdicts = res.retrieval.postfilter.verdicts;
  if (verdicts.length > 0 && verdicts.every((v) => !v.kept)) {
    const n = verdicts.length;
    return {
      kind: "rejected",
      line: `${n} ${n === 1 ? "caso passou" : "casos passaram"} da semelhança mínima, mas a IA conferiu e nenhum trata da mesma causa.`,
      confidence: true,
    };
  }
  return {
    kind: "below",
    line: "Não achei casos parecidos o bastante para sugerir.",
    confidence: true,
  };
}
