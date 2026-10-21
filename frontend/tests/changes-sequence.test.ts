import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMING,
  buildSteps,
  firstSentence,
  fmtDelta,
  formulaTerms,
  gatePassed,
  overallOf,
  parseTime,
  reached,
  scoreDelta,
  verdictOf,
  weightedSegments,
} from "@/app/changes/sequence";
import type { Evaluation, FieldKey, FieldScore } from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

const WEIGHTS: [FieldKey, number][] = [
  ["implementation_plan", 2.5],
  ["validation_plan", 2.5],
  ["objective", 2],
  ["benefits", 2],
  ["test_justification", 2],
  ["short_description", 1.5],
  ["prerequisites", 1],
];

function fields(scores: number[], reused: boolean[] = []): FieldScore[] {
  return WEIGHTS.map(([key, weight], i) => ({
    key,
    label: key,
    weight,
    score: scores[i],
    diagnosis: "",
    guidance: "",
    reused: reused[i] ?? false,
    content_hash: key,
  }));
}

function evaluation(scores: number[], extra: Partial<Evaluation> = {}): Evaluation {
  const fs = fields(scores);
  const total = fs.reduce((s, f) => s + f.weight, 0);
  const overall =
    Math.round((fs.reduce((s, f) => s + f.score * f.weight, 0) / total) * 100) / 100;
  return {
    number: "CHG0031001",
    rubric_version: "2026-10-19",
    scope: { in_scope: true, reason: "" },
    fields: fs,
    overall,
    threshold: 8,
    semantic: null,
    semantic_skipped_reason: null,
    model: "m",
    model_calls: 7,
    duration_ms: 1000,
    ...extra,
  };
}

const semantic = {
  consistency_score: 4,
  problems: ["a", "b", "c"],
  reasoning: "r",
  guidance: "g",
  backout_adherence: "NAO_ADERENTE" as const,
  backout_adherence_percent: 25,
  reused: false,
};

describe("weightedSegments", () => {
  it("lays the fields end to end and ends at the weighted average", () => {
    const avg = weightedSegments(fields([9.5, 9.5, 9, 9, 9, 9.5, 9.5]));
    expect(avg.totalWeight).toBe(13.5);
    expect(avg.numerator).toBeCloseTo(125.25);
    expect(avg.average).toBeCloseTo(9.2778, 3);
    expect(avg.segments[0].start).toBe(0);
    expect(avg.segments[0].contribution).toBeCloseTo((9.5 * 2.5) / 13.5);
    for (let i = 1; i < avg.segments.length; i++) {
      expect(avg.segments[i].start).toBeCloseTo(avg.segments[i - 1].end);
    }
    expect(avg.segments.at(-1)!.end).toBeCloseTo(avg.average);
  });

  it("gives a heavier field a longer segment for the same score", () => {
    const avg = weightedSegments(fields([8, 8, 8, 8, 8, 8, 8]));
    const impl = avg.segments[0].contribution;
    const prereq = avg.segments[6].contribution;
    expect(impl / prereq).toBeCloseTo(2.5);
  });

  it("handles all zeros and an empty list", () => {
    expect(weightedSegments(fields([0, 0, 0, 0, 0, 0, 0])).average).toBe(0);
    const empty = weightedSegments([]);
    expect(empty.average).toBe(0);
    expect(empty.segments).toEqual([]);
  });

  it("computes per-field deltas against the previous evaluation", () => {
    const before = fields([9.5, 8.5, 9, 9, 8.5, 9.5, 9]);
    const after = fields([9.5, 9.5, 9, 9, 8.5, 9.5, 9], [true, false]);
    const avg = weightedSegments(after, before);
    expect(avg.segments[0].delta).toBe(0);
    expect(avg.segments[1].delta).toBe(1);
    expect(avg.segments[0].reused).toBe(true);
    expect(weightedSegments(after).segments[1].delta).toBeNull();
  });
});

describe("formula and formatting", () => {
  it("writes each term as score x weight with the decimal comma", () => {
    const terms = formulaTerms(weightedSegments(fields([9.5, 8.5, 9, 9, 8.5, 9.5, 9])));
    expect(terms[0]).toBe("9,5 × 2,5");
    expect(terms[2]).toBe("9,0 × 2");
    expect(terms[5]).toBe("9,5 × 1,5");
  });

  it("signs deltas with a real minus sign and avoids float noise", () => {
    expect(scoreDelta(9.5, 8.3)).toBe(1.2);
    expect(scoreDelta(8, 8.4)).toBe(-0.4);
    expect(scoreDelta(8, undefined)).toBeNull();
    expect(fmtDelta(1.2)).toBe("+1,2");
    expect(fmtDelta(-0.4)).toBe("−0,4");
    expect(fmtDelta(0)).toBe("0,0");
  });

  it("parses CSS time tokens", () => {
    expect(parseTime("90ms", 1)).toBe(90);
    expect(parseTime(" 0.56s", 1)).toBe(560);
    expect(parseTime("", 600)).toBe(600);
    expect(parseTime("abc", 7)).toBe(7);
  });
});

describe("buildSteps", () => {
  it("runs the full sequence when the gate opens and the semantic analysis ran", () => {
    const ev = evaluation([9.5, 8.5, 9, 9, 8.5, 9.5, 9], { semantic });
    expect(gatePassed(ev)).toBe(true);
    const steps = buildSteps(ev);
    expect(steps.map((s) => s.id)).toEqual([
      "notas",
      "media",
      "portao",
      "coerencia",
      "problemas",
    ]);
    expect(steps[3].caption).toContain("25%");
    expect(steps[4].ms).toBe(3 * DEFAULT_TIMING.problem + DEFAULT_TIMING.hold);
  });

  it("stops at the gate with the plain reason when the average is below the cut", () => {
    const ev = evaluation([1, 0.5, 1.5, 1, 0.5, 2, 1], {
      semantic_skipped_reason: "Nota 1.0 abaixo de 8.0",
    });
    expect(gatePassed(ev)).toBe(false);
    const steps = buildSteps(ev);
    expect(steps.map((s) => s.id)).toEqual(["notas", "media", "portao"]);
    expect(steps[2].caption).toBe("Abaixo do corte: a análise de coerência não roda.");
  });

  it("treats exactly the threshold as passing, like the backend", () => {
    expect(gatePassed(evaluation([8, 8, 8, 8, 8, 8, 8]))).toBe(true);
    // 107,9 / 13,5 = 7,99: below the cut even though it rounds to 8,0.
    expect(gatePassed(evaluation([8, 8, 8, 8, 8, 8, 7.9]))).toBe(false);
  });

  it("explains reuse on a re-evaluation", () => {
    const first = evaluation([9.5, 8.5, 9, 9, 8.5, 9.5, 9]);
    const second = {
      ...evaluation([9.5, 9.5, 9, 9, 8.5, 9.5, 9]),
      fields: fields([9.5, 9.5, 9, 9, 8.5, 9.5, 9], [true, false, true, true, true]),
    };
    expect(buildSteps(second, first)[0].caption).toContain("reaproveitados");
    expect(buildSteps(first)[0].caption).toContain("IA juíza");
  });

  it("has no steps for an evaluation without a score (out of scope)", () => {
    expect(buildSteps({ ...evaluation([1, 1, 1, 1, 1, 1, 1]), overall: null })).toEqual(
      [],
    );
  });

  it("scales step durations with the number of fields and problems", () => {
    const ev = evaluation([9, 9, 9, 9, 9, 9, 9], {
      semantic: { ...semantic, problems: [] },
    });
    const steps = buildSteps(ev);
    const t = DEFAULT_TIMING;
    expect(steps[0].ms).toBe(6 * t.stagger + t.count + t.hold);
    expect(steps[1].ms).toBe(6 * t.term + t.explain * 2 + t.hold);
    expect(steps[4].ms).toBe(t.problem + t.hold);
    expect(steps[4].caption).toContain("Nenhuma incoerência");
  });
});

describe("reached", () => {
  const steps = buildSteps(evaluation([1, 1, 1, 1, 1, 1, 1]));
  it("is false before a step and for a step that is not in the list", () => {
    expect(reached(steps, -1, "notas")).toBe(false);
    expect(reached(steps, 0, "notas")).toBe(true);
    expect(reached(steps, 0, "media")).toBe(false);
    expect(reached(steps, 99, "coerencia")).toBe(false);
    expect(reached(steps, steps.length, "portao")).toBe(true);
  });
});

describe("one overall for headline, bar, formula and gate", () => {
  it("matches the backend: rehearsal grades land on 9,04", () => {
    const ev = evaluation([9.2, 9, 9.4, 8.6, 9.2, 9, 8.6]);
    expect(overallOf(ev)).toBe(9.04);
    expect(gatePassed(ev)).toBe(true);
  });

  it("derives from the fields even when the sent overall disagrees", () => {
    // A stale or hand-made overall must never sit next to a formula that says otherwise.
    const ev = evaluation([9.1, 8.4, 8.8, 7.2, 9, 6.1, 4.5], { overall: 8.2 });
    expect(overallOf(ev)).toBe(7.96);
    expect(gatePassed(ev)).toBe(false);
  });

  it("falls back to the sent overall when there are no fields", () => {
    expect(overallOf(evaluation([], { fields: [], overall: null }))).toBeNull();
  });
});

describe("verdictOf", () => {
  it("says no when the average is below the cut", () => {
    const v = verdictOf(fixture.CHG0031003 as unknown as Evaluation);
    expect(v?.ok).toBe(false);
    expect(v?.title).toBe("Não segue");
    expect(v?.reason).toContain("abaixo do mínimo de 8,0");
  });
  it("says no past the cut when coherence found a problem", () => {
    const v = verdictOf(fixture.CHG0031002 as unknown as Evaluation);
    expect(v?.ok).toBe(false);
    expect(v?.reason).toContain("1 incoerência");
  });
  it("says yes past the cut with no inconsistency", () => {
    const v = verdictOf(fixture.CHG0031001 as unknown as Evaluation);
    expect(v).toMatchObject({ ok: true, title: "Pode seguir" });
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence and ignores dots inside versions", () => {
    expect(firstSentence("Sobe para a v2.3 hoje. Depois valida.")).toBe(
      "Sobe para a v2.3 hoje.",
    );
    expect(firstSentence("Sem ponto final")).toBe("Sem ponto final");
  });
});
