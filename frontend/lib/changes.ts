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

export interface Evaluation {
  number: string;
  rubric_version: string;
  scope: { in_scope: boolean; reason: string };
  fields: FieldScore[];
  overall: number | null;
  threshold: number;
  semantic: SemanticAnalysis | null;
  semantic_skipped_reason: string | null;
  model: string;
  model_calls: number;
  duration_ms: number;
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

export const ADHERENCE_LABEL: Record<BackoutAdherence, string> = {
  ADERENTE: "Aderente",
  PARCIAL: "Parcialmente aderente",
  NAO_ADERENTE: "Não aderente",
};

/** Score band shared by the field chips and the overall meter. */
export function band(score: number): "good" | "mid" | "low" {
  if (score >= 8) return "good";
  if (score >= 5) return "mid";
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
  /** The whole verdict: past the cut and no inconsistency. Older marks lack it. */
  ok?: boolean;
}

const EVAL_KEY = "is-evaluated";

/** Marks kept per tab (sessionStorage): a convenience, never the record. */
export function readEvalMarks(): Record<string, EvalMark> {
  try {
    const raw = window.sessionStorage.getItem(EVAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, EvalMark>)
      : {};
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
