// The assistant's follow-up questions (E2E round 3 P1-2). The first question is
// the full analysis; what the person types afterwards is one grounded answer
// from the incident, the analysis the server kept for this visitor (verdict,
// suggestion and kept cases) and nothing else. It never re-runs the analysis
// and never publishes a note.
import { isSuggestResponse } from "./suggest-guard";
import { ApiError } from "./api";
import type { AskBody, AskResponse, SuggestResponse } from "./types";

/** "A, B e C". */
export function joinPt(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** The longest question the server takes; the field stops there. */
export const QUESTION_MAX = 600;
/** The counter shows from here on, so the limit never comes as a surprise. */
const COUNT_FROM = 480;

/** The field's counter, near the limit only: "540/600". */
export function questionCount(length: number): string | null {
  return length >= COUNT_FROM ? `${length}/${QUESTION_MAX}` : null;
}

/**
 * The request for a typed question. The server answers from the analysis it
 * kept for this visitor; the ids are only a hint for older servers.
 */
export function followUpBody(
  analysis: SuggestResponse | null,
  question: string,
  model?: string,
): AskBody {
  return {
    question: question.trim(),
    context_ids: analysis?.context_ids ?? [],
    // The analysis on screen: another tab's run makes the server ask to re-sync.
    ...(analysis?.analysis_id ? { analysis_id: analysis.analysis_id } : {}),
    ...(model ? { model } : {}),
  };
}

/** The small line under a follow-up answer: what it stands on, or that it can't. */
export function askNote(res: AskResponse): string | null {
  if (res.kind === "off_topic") return null;
  if (res.context_ids.length === 0)
    return res.kind === "not_in_cases"
      ? "Esta análise não usou casos parecidos, então não há base para isso. Nada foi inventado."
      : "Esta análise não usou casos parecidos: a resposta parte do incidente e do veredito.";
  if (res.kind === "not_in_cases")
    return "Os casos desta análise não respondem a isso. Nada foi inventado.";
  return res.citations.cited.length > 0
    ? `Com base em ${joinPt(res.citations.cited)}.`
    : "Sem caso citado: confira antes de usar.";
}

/**
 * The input's placeholder, short enough for a 360 px phone. It offers only
 * what the analysis has: no suggestion on an improcedente or an empty base.
 */
export function inputHint(analysis: SuggestResponse | null): string {
  if (!analysis) return "Pergunte sobre o incidente…";
  if (analysis.classification === "PROCEDENTE" && analysis.suggestion)
    return "Pergunte sobre a sugestão…";
  return "Pergunte sobre a análise…";
}

/** One typed question in the chat. */
export interface Turn {
  id: number;
  question: string;
  /** "waiting": asked before the analysis; it is sent once the analysis lands. */
  state: "waiting" | "running" | "done" | "error";
  res: AskResponse | null;
  error: string | null;
  /** The analysis already ran again once for this question (after a 409). */
  resynced?: boolean;
  /** The error can only be fixed by a new analysis: it offers "Analisar de novo". */
  needsAnalysis?: boolean;
  /** No analysis ran yet: the button reads "Analisar o incidente". */
  firstAnalysis?: boolean;
}

/** Said when a question comes before any analysis; the analysis is a choice. */
export const NO_ANALYSIS =
  "Para responder sobre este incidente, a IA precisa analisá-lo antes. A análise leva alguns segundos.";

/** Said when the server still has no analysis after running it again. */
export const LOST_ANALYSIS =
  "O servidor não encontrou a análise desta tela (ele pode ter reiniciado). Analise de novo e a pergunta é feita em seguida.";

/**
 * What a failed question does next. A 409 means the server holds no analysis
 * for this visitor, or another one than the page shows. With no analysis on
 * screen, nothing runs unasked: the chat says so and offers "Analisar o
 * incidente". Under an analysis on screen (a restart, another tab), the
 * analysis runs again once, silently, and the question waits for it. A second
 * 409 for the same question stops with a sentence and "Analisar de novo";
 * anything else keeps its own message and "Tentar de novo".
 */
export function afterAskError(
  turn: Turn,
  error: unknown,
  onScreen: boolean,
): { turn: Turn; reanalyze: boolean } {
  if (error instanceof ApiError && error.status === 409 && !onScreen)
    return {
      turn: {
        ...turn,
        state: "error",
        res: null,
        error: NO_ANALYSIS,
        needsAnalysis: true,
        firstAnalysis: true,
      },
      reanalyze: false,
    };
  if (error instanceof ApiError && error.status === 409) {
    if (!turn.resynced)
      return {
        turn: { ...turn, state: "waiting", res: null, error: null, resynced: true },
        reanalyze: true,
      };
    return {
      turn: {
        ...turn,
        state: "error",
        res: null,
        error: LOST_ANALYSIS,
        needsAnalysis: true,
      },
      reanalyze: false,
    };
  }
  const detail =
    error instanceof ApiError ? error.detail : "Não foi possível responder agora.";
  return {
    turn: { ...turn, state: "error", res: null, error: detail, needsAnalysis: false },
    reanalyze: false,
  };
}

/**
 * A new analysis (the person asked for it) starts a new conversation: the
 * answers about the old one would contradict what is on screen. A question
 * still waiting for an analysis stays, to be asked after this one.
 */
export function restartTurns(turns: Turn[]): { turns: Turn[]; restarted: boolean } {
  const kept = turns.filter((t) => t.state === "waiting");
  return { turns: kept, restarted: kept.length < turns.length };
}

/** Put a turn back where it was (a retry never moves it), or add it at the end. */
export function upsertTurn(turns: Turn[], turn: Turn): Turn[] {
  return turns.some((t) => t.id === turn.id)
    ? turns.map((t) => (t.id === turn.id ? turn : t))
    : [...turns, turn];
}

/**
 * What the questions waiting for the analysis do now: asked once it is done,
 * kept (with the analysis's own retry) while it runs or after it failed.
 */
export function settleTurns(
  turns: Turn[],
  phase: "idle" | "running" | "done" | "error",
): { keep: Turn[]; ask: Turn[] } {
  if (phase !== "done") return { keep: turns, ask: [] };
  return { keep: turns, ask: turns.filter((t) => t.state === "waiting") };
}

/* ------------------------------------------------------------ the session */

/** What comes back when the person leaves the incident and returns. */
export interface ChatMemory {
  response: SuggestResponse;
  durationMs: number | null;
  model: string;
  turns: Turn[];
}

const chatKey = (number: string) => `incident-sense:chat:${number.toUpperCase()}`;

/** Keep the analysis and the answered questions for this tab's session. */
export function saveChat(number: string, memory: ChatMemory): void {
  const settled = memory.turns.filter((t) => t.state === "done" || t.state === "error");
  try {
    window.sessionStorage.setItem(
      chatKey(number),
      JSON.stringify({ ...memory, turns: settled }),
    );
  } catch {
    // Private mode or a full quota: the chat just starts over next time.
  }
}

/** The analysis and the chat kept for this incident, or null. */
export function readChat(number: string): ChatMemory | null {
  try {
    const raw = window.sessionStorage.getItem(chatKey(number));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ChatMemory>;
    if (!isSuggestResponse(data.response) || !Array.isArray(data.turns)) return null;
    return {
      response: data.response,
      durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
      model: typeof data.model === "string" ? data.model : "",
      turns: data.turns.filter(
        (t): t is Turn =>
          typeof t === "object" &&
          t !== null &&
          typeof t.id === "number" &&
          typeof t.question === "string" &&
          (t.state === "done" || t.state === "error"),
      ),
    };
  } catch {
    return null;
  }
}
