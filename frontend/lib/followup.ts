// The assistant's follow-up questions (E2E round 3 P1-2). The first question is
// the full analysis; what the person types afterwards is one grounded answer
// from the incident and the cases that analysis kept. It never re-runs the
// analysis and never publishes a note.
import type { AskBody, AskResponse, SuggestResponse } from "./types";

/** "A, B e C". */
export function joinPt(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** The request for a typed question: the kept cases are the only sources. */
export function followUpBody(
  analysis: SuggestResponse,
  question: string,
  model?: string,
): AskBody {
  return {
    question: question.trim(),
    context_ids: analysis.context_ids,
    ...(model ? { model } : {}),
  };
}

/** The small line under a follow-up answer: what it stands on, or that it can't. */
export function askNote(res: AskResponse): string | null {
  if (res.kind === "off_topic") return null;
  if (res.kind === "not_in_cases")
    return "Os casos desta análise não respondem a isso. Nada foi inventado.";
  return res.citations.cited.length > 0
    ? `Com base em ${joinPt(res.citations.cited)}.`
    : "Sem caso citado: confira antes de usar.";
}

/** The input's placeholder: before the analysis, typing starts it. */
export function inputHint(analysed: boolean): string {
  return analysed
    ? "Pergunte sobre a sugestão ou os casos…"
    : "Escreva sua dúvida; antes, a IA analisa o incidente…";
}
