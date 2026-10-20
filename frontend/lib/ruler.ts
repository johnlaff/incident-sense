// The similarity ruler: pure geometry and counts, unit-tested in
// tests/ruler.test.ts. Every number here comes from the run (similarities,
// the 0,80 floor, the post-filter verdicts); the simulation only re-applies
// layer 2 to the same similarities.

import type { RetrievalRow } from "./pipeline";
import type { SuggestResponse } from "./types";

/** The ruler shows cosine similarity from 0,50 to 1,00 (direcao.md, P4b). */
export const RULER_MIN = 0.5;
export const RULER_MAX = 1;
export const RULER_TICKS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** 0..1 along the ruler. Values under the ruler sit on its left edge. */
export function rulerX(sim: number, min = RULER_MIN, max = RULER_MAX): number {
  if (!Number.isFinite(sim)) return 0;
  return Math.min(1, Math.max(0, (sim - min) / (max - min)));
}

export interface RulerDot {
  number: string;
  sim: number;
  x: number;
  /** Stacked lane when dots would overlap (0 is the axis line). */
  lane: number;
  /** Order of arrival in the cascade (left to right: lowest first). */
  order: number;
  passed: boolean;
  /** Below the visible range (sim < 0,50): pinned to the left edge. */
  clipped: boolean;
}

/**
 * Place the dots: x from the real similarity, and a lane per dot so two dots
 * closer than `minGap` (as a fraction of the ruler) never sit on each other.
 * Greedy, left to right: each dot takes the lowest lane whose last dot is
 * far enough away.
 */
export function rulerDots(
  rows: Pick<RetrievalRow, "number" | "sim">[],
  floor: number,
  minGap = 0.045,
): RulerDot[] {
  const sorted = rows
    .map((r, i) => ({ ...r, i, x: rulerX(r.sim) }))
    .sort((a, b) => a.x - b.x || a.i - b.i);
  const laneEnds: number[] = [];
  const placed = sorted.map((r, order) => {
    let lane = laneEnds.findIndex((end) => r.x - end >= minGap);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(r.x);
    } else laneEnds[lane] = r.x;
    return {
      number: r.number,
      sim: r.sim,
      x: r.x,
      lane,
      order,
      passed: r.sim >= floor,
      clipped: r.sim < RULER_MIN,
    };
  });
  // Back in the caller's order (the rows list), with the arrival order kept.
  const byNumber = new Map(placed.map((d) => [d.number, d]));
  return rows.map((r) => byNumber.get(r.number)!);
}

export function laneCount(dots: RulerDot[]): number {
  return dots.reduce((m, d) => Math.max(m, d.lane + 1), 0);
}

export interface Funnel {
  /** Layer 2 searched for up to this many (top-K incidents + problems). */
  topK: number;
  /** Candidates the vector search returned. */
  candidates: number;
  /** Candidates at or above the floor (layer 2 output). */
  passed: number;
  /** Candidates the post-filter kept (layer 3 output). */
  kept: number;
}

export function funnel(res: SuggestResponse, rows: RetrievalRow[]): Funnel {
  const { vector } = res.retrieval;
  return {
    topK: vector.incident_top_k + vector.problem_top_k,
    candidates: rows.length,
    passed: rows.filter((r) => r.outcome !== "abaixo").length,
    kept: rows.filter((r) => r.outcome === "mantido" || r.outcome === "mantido-fallback")
      .length,
  };
}

/** "Simulação: só a camada 2": how many of the same candidates would pass. */
export function simulatePass(
  rows: Pick<RetrievalRow, "sim">[],
  threshold: number,
): number {
  return rows.filter((r) => r.sim >= threshold - 1e-9).length;
}

/** Snap a slider value to two decimals inside the ruler. */
export function snapThreshold(value: number): number {
  const clamped = Math.min(RULER_MAX, Math.max(RULER_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** The angle between two vectors with this cosine, in degrees (P4c). */
export function cosineAngle(sim: number): number {
  const c = Math.min(1, Math.max(-1, sim));
  return (Math.acos(c) * 180) / Math.PI;
}
