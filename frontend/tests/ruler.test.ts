import { describe, expect, it } from "vitest";

import { retrievalRows } from "@/lib/pipeline";
import {
  cosineAngle,
  funnel,
  laneCount,
  rulerDots,
  rulerX,
  simulatePass,
  snapThreshold,
} from "@/lib/ruler";

import { suggestFixture } from "./suggest-fixture";

describe("rulerX", () => {
  it("maps 0,50 to the left edge and 1,00 to the right", () => {
    expect(rulerX(0.5)).toBe(0);
    expect(rulerX(1)).toBe(1);
    expect(rulerX(0.8)).toBeCloseTo(0.6);
    expect(rulerX(0.84)).toBeCloseTo(0.68);
  });

  it("pins values outside the ruler to its edges", () => {
    expect(rulerX(0.31)).toBe(0);
    expect(rulerX(1.2)).toBe(1);
    expect(rulerX(Number.NaN)).toBe(0);
  });
});

describe("rulerDots", () => {
  it("keeps the caller's order, marks who passed and who is off the ruler", () => {
    const dots = rulerDots(
      [
        { number: "A", sim: 0.84 },
        { number: "B", sim: 0.72 },
        { number: "C", sim: 0.42 },
      ],
      0.8,
    );
    expect(dots.map((d) => d.number)).toEqual(["A", "B", "C"]);
    expect(dots.map((d) => d.passed)).toEqual([true, false, false]);
    expect(dots[2].clipped).toBe(true);
    // Arrival order runs left to right.
    expect(dots.map((d) => d.order)).toEqual([2, 1, 0]);
  });

  it("stacks dots that would overlap into lanes", () => {
    const dots = rulerDots(
      [
        { number: "A", sim: 0.81 },
        { number: "B", sim: 0.812 },
        { number: "C", sim: 0.815 },
        { number: "D", sim: 0.9 },
      ],
      0.8,
    );
    expect(dots.map((d) => d.lane)).toEqual([0, 1, 2, 0]);
    expect(laneCount(dots)).toBe(3);
  });
});

describe("funnel", () => {
  it("counts each layer's output from the real verdicts", () => {
    const res = suggestFixture();
    const rows = [...retrievalRows(res, "incidente"), ...retrievalRows(res, "problema")];
    expect(funnel(res, rows)).toEqual({ topK: 15, candidates: 4, passed: 3, kept: 2 });
  });
});

describe("the threshold simulation", () => {
  it("re-applies layer 2 to the same similarities", () => {
    const rows = [{ sim: 0.84 }, { sim: 0.81 }, { sim: 0.72 }, { sim: 0.8 }];
    expect(simulatePass(rows, 0.8)).toBe(3);
    expect(simulatePass(rows, 0.7)).toBe(4);
    expect(simulatePass(rows, 0.85)).toBe(0);
  });

  it("snaps the slider to two decimals inside the ruler", () => {
    expect(snapThreshold(0.7649)).toBe(0.76);
    expect(snapThreshold(0.2)).toBe(0.5);
    expect(snapThreshold(3)).toBe(1);
  });
});

describe("cosineAngle", () => {
  it("turns a cosine into the angle between the vectors", () => {
    expect(cosineAngle(1)).toBe(0);
    expect(cosineAngle(0.8)).toBeCloseTo(36.87, 1);
    expect(cosineAngle(0.84)).toBeCloseTo(32.86, 1);
    expect(cosineAngle(1.0000001)).toBe(0);
  });
});
