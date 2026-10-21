"use client";

// Changes: wire types for /api/changes and the per-field LLM-as-judge result.
import { api } from "./api";
import { useAsync, type AsyncState } from "./incidents";

export const EVALUATED_FIELDS = [
  "implementation_plan",
  "validation_plan",
  "objective",
  "benefits",
  "test_justification",
  "short_description",
  "prerequisites",
] as const;
export type FieldKey = (typeof EVALUATED_FIELDS)[number];

export interface ChangeTask {
  number: string;
  short_description: string;
}

export interface ChangeSummary {
  number: string;
  short_description: string;
  type: string;
  state: string;
  company: string;
  cmdb_ci: string;
  risk: string;
  planned_start: string;
  in_scope: boolean;
  scenario: string;
  /** The title in plain words (may be missing from an older backend). */
  plain?: string;
}

export interface Change extends Record<FieldKey, string> {
  number: string;
  type: string;
  state: string;
  company: string;
  cmdb_ci: string;
  assignment_group: string;
  risk: string;
  requested_by: string;
  planned_start: string;
  planned_end: string;
  backout_plan: string;
  tasks: ChangeTask[];
  scenario: string;
  scenario_note: string;
  /** One plain sentence per field card, keyed by field (and backout_plan). */
  plain_summary?: Partial<Record<FieldKey | "backout_plan", string>>;
}

export interface RubricField {
  key: FieldKey;
  label: string;
  weight: number;
  criteria: string[];
}

export interface Rubric {
  version: string;
  eligibility_threshold: number;
  fields: RubricField[];
}

export interface FieldScore {
  key: FieldKey;
  label: string;
  weight: number;
  score: number;
  diagnosis: string;
  guidance: string;
  reused: boolean;
  content_hash: string;
}

export type BackoutAdherence = "ADERENTE" | "PARCIAL" | "NAO_ADERENTE";

export interface SemanticAnalysis {
  consistency_score: number;
  problems: string[];
  reasoning: string;
  guidance: string;
  backout_adherence: BackoutAdherence;
  backout_adherence_percent: number;
  reused: boolean;
}

export type DecisionReason =
  | "passes"
  | "average_below"
  | "semantic_missing"
  | "coherence_below"
  | "backout_not_adherent";

export interface EvaluationDecision {
  passes: boolean;
  reason_code: DecisionReason;
  reason: string;
}

export interface Evaluation {
  number: string;
  rubric_version: string;
  scope: { in_scope: boolean; reason: string };
  fields: FieldScore[];
  overall: number | null;
  threshold: number;
  semantic: SemanticAnalysis | null;
  semantic_skipped_reason: string | null;
  /**
   * The backend's verdict, the one every view shows. Null when the change is
   * out of scope; absent from older servers (the screen then computes it).
   */
  decision?: EvaluationDecision | null;
  model: string;
  model_calls: number;
  duration_ms: number;
}

/**
 * True when a response has the shape the screen reads. A proxy error page or
 * an older backend can answer 200 with something else; the screen then shows
 * its error state instead of breaking.
 */
export function isEvaluation(value: unknown): value is Evaluation {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<Evaluation>;
  return (
    Array.isArray(v.fields) &&
    v.fields.every(
      (f) => f && typeof f.key === "string" && typeof f.score === "number",
    ) &&
    typeof v.scope === "object" &&
    v.scope !== null &&
    typeof v.scope.in_scope === "boolean" &&
    typeof v.threshold === "number"
  );
}

export interface EvaluateBody {
  fields?: Partial<Record<FieldKey, string>>;
  backout_plan?: string;
  model?: string;
}

export const TYPE_LABEL: Record<string, string> = {
  Normal: "Normal",
  Standard: "Padrão",
  Emergency: "Emergencial",
};

export const STATE_LABEL: Record<string, string> = {
  New: "Nova",
  Scheduled: "Agendada",
  Implement: "Em implantação",
  Closed: "Encerrada",
};

/**
 * The plain-words title to lead with, or null when the plain line is a remark
 * about a vague title ("O título não diz..."): then the title itself leads.
 */
export function plainTitle(plain: string | undefined | null): string | null {
  const t = (plain ?? "").trim();
  if (!t || /^o título não diz/i.test(t)) return null;
  return t;
}

/** The type and state in plain words, for a reader new to ITSM. */
export const TYPE_HINT: Record<string, string> = {
  Normal: "comum, não urgente",
  Standard: "de rotina, já pré-aprovado",
  Emergency: "urgente",
};

export const STATE_HINT: Record<string, string> = {
  New: "ainda não analisada",
  Scheduled: "com data marcada",
  Implement: "sendo feita agora",
  Closed: "já terminou",
};

export const ADHERENCE_LABEL: Record<BackoutAdherence, string> = {
  ADERENTE: "Aderente",
  PARCIAL: "Parcialmente aderente",
  NAO_ADERENTE: "Não aderente",
};

/**
 * Score band shared by the field chips and the overall meter. It reads the
 * number as shown (one decimal, two for the average), so "8,0" is never
 * drawn amber and "7,96" is never drawn green.
 */
export function band(score: number, places = 1): "good" | "mid" | "low" {
  const f = 10 ** places;
  const shown = Math.round(score * f) / f;
  if (shown >= 8) return "good";
  if (shown >= 5) return "mid";
  return "low";
}

/** Brazilian decimal comma, one place: 8.6 -> "8,6". */
export function nota(score: number): string {
  return score.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function useChanges(): AsyncState<ChangeSummary[]> {
  return useAsync(() => api.listChanges(), []);
}

export function useChange(number: string): AsyncState<Change> {
  return useAsync(() => api.getChange(number), [number]);
}

export function useRubric(): AsyncState<Rubric> {
  return useAsync(() => api.getRubric(), []);
}

// ----- Evaluated in this session ------------------------------------------------

/** What /changes shows for a Change evaluated in this browser session. */
export interface EvalMark {
  /** Weighted average as the page shows it, null when out of scope. */
  overall: number | null;
  passed: boolean;
  /** The whole verdict, the backend's decision. Older marks lack it. */
  ok?: boolean;
  /** The result was read with edited text, not the Change as registered. */
  edited?: boolean;
}

const EVAL_KEY = "is-evaluated";

function isMark(v: unknown): v is EvalMark {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<EvalMark>;
  return (
    (m.overall === null || typeof m.overall === "number") &&
    typeof m.passed === "boolean" &&
    (m.ok === undefined || typeof m.ok === "boolean") &&
    (m.edited === undefined || typeof m.edited === "boolean")
  );
}

/** Marks kept per tab (sessionStorage): a convenience, never the record. */
export function readEvalMarks(): Record<string, EvalMark> {
  try {
    const raw = window.sessionStorage.getItem(EVAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => isMark(v)),
    ) as Record<string, EvalMark>;
  } catch {
    return {};
  }
}

export function markEvaluated(number: string, mark: EvalMark): void {
  try {
    const all = readEvalMarks();
    all[number] = mark;
    window.sessionStorage.setItem(EVAL_KEY, JSON.stringify(all));
  } catch {
    // Private mode or blocked storage: the list just shows no mark.
  }
}

// ----- The last result, to reopen it ------------------------------------------

type Edits = Partial<Record<FieldKey, string>>;

/** The last evaluation of a Change in this tab, with the text it read. */
export interface SavedEvaluation {
  edits: Edits;
  model: string;
  result: Evaluation;
  /** When it came back (ms since epoch). */
  at: number;
}

/** A short fingerprint of every text the AI reads, edits applied. */
export function contentHash(change: Change, edits: Edits): string {
  const parts = [
    ...EVALUATED_FIELDS.map((k) => edits[k] ?? change[k] ?? ""),
    change.backout_plan ?? "",
    ...(change.tasks ?? []).map((t) => `${t.number}:${t.short_description}`),
  ];
  // FNV-1a, 32 bits: enough to notice a changed text, not a security hash.
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0000")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const savedKey = (number: string) => `is-eval:${number}`;

export function saveEvaluation(change: Change, saved: SavedEvaluation): void {
  try {
    window.sessionStorage.setItem(
      savedKey(change.number),
      JSON.stringify({ ...saved, hash: contentHash(change, saved.edits) }),
    );
  } catch {
    // Full or blocked storage: the page just opens without the last result.
  }
}

/** The saved result, only if the Change still has the text it was read with. */
export function readSavedEvaluation(change: Change): SavedEvaluation | null {
  try {
    const raw = window.sessionStorage.getItem(savedKey(change.number));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedEvaluation> & { hash?: string };
    if (!v || !isEvaluation(v.result) || typeof v.at !== "number") return null;
    const edits = v.edits && typeof v.edits === "object" ? v.edits : {};
    if (v.hash !== contentHash(change, edits)) return null;
    return {
      edits,
      model: typeof v.model === "string" ? v.model : "",
      result: v.result,
      at: v.at,
    };
  } catch {
    return null;
  }
}
