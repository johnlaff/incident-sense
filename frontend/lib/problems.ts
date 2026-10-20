"use client";

// Problems: wire types for /api/problems and the helpers every Problem mention
// shares (the PRB number check, the state badge, the match to a recurrence).
import { api } from "./api";
import { useAsync, type AsyncState } from "./incidents";
import type { IncidentSummary } from "./types";

export interface ProblemSummary {
  number: string;
  short_description: string;
  root_cause: string;
  state: string;
  category: string;
  subcategory: string;
  cmdb_ci: string;
  assignment_group: string;
  opened_at: string;
  resolved_at: string | null;
  tags: string[];
  linked_incidents: string[];
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  workaround: string;
  permanent_fix: string;
  empresa: string;
  /** Linked incidents the base knows, newest first. */
  related: IncidentSummary[];
  cluster_id: number | null;
  cluster_label: string | null;
}

/** The one plain sentence every Problem screen opens with. */
export const PROBLEM_DEFINITION =
  "Um problema reúne a causa raiz de incidentes que se repetem e a solução conhecida.";

const PRB_RE = /^PRB\d{4,}$/;

/** True for a Problem number (PRB…), false for an incident or anything else. */
export function isProblemNumber(id: string): boolean {
  return PRB_RE.test(id);
}

export type ProblemTone = "resolved" | "known";

/** Badge tone and label for a Problem state ("Resolvido" or "Erro conhecido"). */
export function problemState(state: string): { tone: ProblemTone; label: string } {
  return state.toLowerCase().startsWith("resolv")
    ? { tone: "resolved", label: "Resolvido" }
    : { tone: "known", label: "Erro conhecido" };
}

/**
 * The Problems that explain a recurrence group: those whose linked incidents
 * fall mostly inside the group. Most matched first.
 */
export function problemsForGroup(
  problems: readonly ProblemSummary[],
  incidentNumbers: readonly string[],
): ProblemSummary[] {
  const inGroup = new Set(incidentNumbers);
  return problems
    .map((p) => ({
      p,
      hits: p.linked_incidents.filter((n) => inGroup.has(n)).length,
    }))
    .filter(({ p, hits }) => hits > 0 && hits * 2 >= p.linked_incidents.length)
    .sort((a, b) => b.hits - a.hits || a.p.number.localeCompare(b.p.number))
    .map(({ p }) => p);
}

export function useProblems(): AsyncState<ProblemSummary[]> {
  return useAsync(() => api.listProblems(), []);
}

export function useProblem(number: string): AsyncState<ProblemDetail> {
  return useAsync(() => api.getProblem(number), [number]);
}
