import { ApiError } from "./api";
import type { SuggestResponse } from "./types";

/**
 * True when an analysis response has the shape the screen reads. A proxy or
 * an older backend can answer 200 with something else; the card then shows
 * its error state instead of the whole page breaking.
 */
export function isSuggestResponse(value: unknown): value is SuggestResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SuggestResponse>;
  const obj = (x: unknown) => typeof x === "object" && x !== null;
  return (
    typeof v.classification === "string" &&
    (v.suggestion === null || typeof v.suggestion === "string") &&
    Array.isArray(v.steps) &&
    Array.isArray(v.candidates) &&
    Array.isArray(v.problems) &&
    Array.isArray(v.context_ids) &&
    obj(v.retrieval) &&
    obj(v.decision) &&
    obj(v.citations) &&
    obj(v.publication)
  );
}

/** What the analysis card says when the call fails. */
export function suggestErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Não foi possível falar com a IA agora.";
  if (e.status === 503) {
    if (/not configured/i.test(e.detail))
      return "A IA não está configurada neste servidor.";
    if (/^O servidor respondeu com erro/.test(e.detail))
      return "O servidor está reiniciando. Tente de novo em alguns segundos.";
  }
  return e.detail;
}
