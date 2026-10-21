import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMING,
  avgDelta,
  buildSteps,
  decisionOf,
  rerunHint,
  runningLine,
  sentFields,
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
    score: scores[i] as number,
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
    Math.round((fs.reduce((s, f) => s + (f.score ?? 0) * f.weight, 0) / total) * 100) /
    100;
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
    expect(steps[2].caption).toBe(
      "Pergunta 1 de 2: a média ficou abaixo de 8,0. Não segue, e a pergunta 2 nem é feita.",
    );
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
      semantic: {
        ...semantic,
        consistency_score: 9,
        backout_adherence: "ADERENTE",
        problems: [],
      },
    });
    const steps = buildSteps(ev);
    const t = DEFAULT_TIMING;
    expect(steps[0].ms).toBe(6 * t.stagger + t.count + t.hold);
    expect(steps[1].ms).toBe(6 * t.term + t.explain * 2 + t.hold);
    expect(steps[4].ms).toBe(t.problem + t.hold);
    expect(steps[4].caption).toContain("Nada se contradiz");
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

// What the real model returned for CHG0031001: a high average, coherence on
// the cut, back-out ADERENTE. Its four suggestions now live in guidance;
// "problems" holds only real contradictions, and one would hold it back.
const realLike = (): Evaluation =>
  evaluation([9.5, 9.4, 9.2, 9.0, 9.3, 9.1, 8.8], {
    semantic: {
      consistency_score: 8,
      problems: [],
      reasoning: "As partes contam a mesma história.",
      guidance:
        "O objetivo poderia citar o indicador de sucesso. O retorno poderia dar o tempo estimado.",
      backout_adherence: "ADERENTE",
      backout_adherence_percent: 90,
      reused: false,
    },
  });

describe("decisionOf", () => {
  it("lets the change go on when both gates pass, whatever the suggestions say", () => {
    const d = decisionOf(realLike());
    expect(d).toMatchObject({
      ok: true,
      failing: null,
      average: { value: 9.24, state: "pass" },
      coherence: { value: 8, adherence: "ADERENTE", state: "pass" },
    });
  });
  it("holds the change on gate 2 when coherence is under the cut", () => {
    const d = decisionOf(fixture.CHG0031002 as unknown as Evaluation);
    expect(d).toMatchObject({
      ok: false,
      failing: "coherence",
      average: { state: "pass" },
      coherence: { value: 4, state: "fail" },
    });
  });
  it("holds the change on gate 1 and never asks gate 2", () => {
    const d = decisionOf(fixture.CHG0031003 as unknown as Evaluation);
    expect(d).toMatchObject({
      ok: false,
      failing: "average",
      average: { value: 3.13, state: "fail" },
      coherence: { value: null, state: "skipped" },
    });
  });
  it("fails gate 2 when the back-out plan does not undo the change", () => {
    const ev = realLike();
    ev.semantic = {
      ...ev.semantic!,
      consistency_score: 9,
      backout_adherence: "NAO_ADERENTE",
    };
    expect(decisionOf(ev)).toMatchObject({ ok: false, failing: "coherence" });
  });
  it("follows the backend's decision when it disagrees with the local numbers", () => {
    const ev = realLike();
    ev.decision = {
      passes: false,
      reason_code: "backout_not_adherent",
      reason: "O plano de retorno não desfaz o que as tarefas fazem.",
    };
    expect(decisionOf(ev)).toMatchObject({
      ok: false,
      failing: "coherence",
      coherence: { state: "fail" },
    });
  });
  it("reads a backend pass even on a borderline 7,96 (shown as 8,0)", () => {
    const ev = realLike();
    ev.semantic = { ...ev.semantic!, consistency_score: 7.96 };
    ev.decision = { passes: true, reason_code: "passes", reason: "" };
    expect(decisionOf(ev)).toMatchObject({
      ok: true,
      coherence: { value: 8, state: "pass" },
    });
  });
  it("every fixture carries the backend decision and the local reading agrees", () => {
    for (const ev of Object.values(fixture) as unknown as Evaluation[]) {
      expect(ev.decision).toBeTruthy();
      expect(decisionOf(ev)?.ok).toBe(ev.decision!.passes);
    }
  });
  it("lists the fields under the cut, lowest first", () => {
    const d = decisionOf(fixture.CHG0031001 as unknown as Evaluation);
    expect(d?.ok).toBe(true);
    expect(d?.low.map((f) => f.key)).toEqual(["prerequisites"]);
  });
});

describe("verdictOf", () => {
  it("says no when the average is below the cut", () => {
    const v = verdictOf(fixture.CHG0031003 as unknown as Evaluation);
    expect(v?.ok).toBe(false);
    expect(v?.title).toBe("Não segue");
    expect(v?.reason).toContain("abaixo do mínimo de 8,0");
  });
  it("says no past the cut when the parts do not agree", () => {
    const v = verdictOf(fixture.CHG0031002 as unknown as Evaluation);
    expect(v?.ok).toBe(false);
    expect(v?.reason).toContain("coerência 4,0, abaixo de 8,0");
  });
  it("says yes for the real CHG0031001 reading and never says contradiction", () => {
    const v = verdictOf(realLike());
    expect(v).toMatchObject({ ok: true, title: "Pode seguir" });
    expect(v?.reason).not.toMatch(/contradi/i);
  });
  it("says yes and names a field still under the cut", () => {
    const v = verdictOf(fixture.CHG0031001 as unknown as Evaluation);
    expect(v).toMatchObject({ ok: true, title: "Pode seguir" });
    expect(v?.reason).toContain("Um campo ficou abaixo de 8,0");
    expect(v?.reason).toContain("(7,5)");
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

describe("re-evaluation words (auditoria P1-3, P2-5)", () => {
  it("says every field goes back when the model changed", () => {
    expect(rerunHint({ dirty: 1, modelChanged: true, total: 7 })).toBe(
      "Modelo trocado: os 7 campos voltam para a IA.",
    );
    expect(sentFields({ dirty: 1, modelChanged: true, total: 7, first: false })).toBe(7);
  });
  it("speaks of one field in the singular", () => {
    expect(runningLine(1)).not.toMatch(/os 1 campos/);
    expect(runningLine(1)).toContain("o campo que mudou");
  });
  it("says it is only checking when nothing changed", () => {
    expect(sentFields({ dirty: 0, modelChanged: false, total: 7, first: false })).toBe(0);
    expect(runningLine(0)).toBe("Conferindo se algo mudou desde a última avaliação.");
    expect(rerunHint({ dirty: 0, modelChanged: false, total: 7 })).toBeNull();
  });
  it("reads all fields the first time", () => {
    expect(sentFields({ dirty: 0, modelChanged: false, total: 7, first: true })).toBe(7);
    expect(runningLine(7)).toContain("os 7 campos em paralelo");
  });
});

describe("average delta (auditoria P2-17)", () => {
  it("shows the average's change with two places, like the average", () => {
    expect(fmtDelta(avgDelta(7.96, 7.92), 2)).toBe("+0,04");
    expect(avgDelta(7.96, 7.92)).not.toBe(0);
  });
});
