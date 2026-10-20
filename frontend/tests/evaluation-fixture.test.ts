// The Change evaluation fixture is a real backend response (stub judge only), written by
// backend/scripts/evaluation_fixture.py. These checks keep it honest for the screenshots.
import { describe, expect, it } from "vitest";

import { gatePassed, overallOf } from "@/app/changes/sequence";
import type { Evaluation } from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

const evaluations = fixture as unknown as Record<string, Evaluation>;

describe("evaluation fixture", () => {
  it.each(Object.keys(evaluations))("%s: the page math matches the backend", (number) => {
    const ev = evaluations[number];
    expect(overallOf(ev)).toBe(ev.overall);
  });

  it.each(Object.keys(evaluations))(
    "%s: one reading and one suggestion per field",
    (number) => {
      const ev = evaluations[number];
      const readings = new Set(ev.fields.map((f) => f.diagnosis));
      expect(readings.size).toBe(ev.fields.length);
      for (const f of ev.fields) expect(f.guidance.trim()).not.toBe("");
    },
  );

  it("tells the story the app tells: 001 passes, 002 passes the fields, 003 stops", () => {
    expect(gatePassed(evaluations.CHG0031001)).toBe(true);
    expect(gatePassed(evaluations.CHG0031002)).toBe(true);
    expect(gatePassed(evaluations.CHG0031003)).toBe(false);
  });
});
