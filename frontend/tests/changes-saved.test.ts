// E2E P0-4: a Change counted in "Avaliadas" reopens with its result.
// Auditoria P1-2 and P2-15: the mark says when the text was edited, and a
// broken mark never breaks the list.

import { afterEach, describe, expect, it } from "vitest";

import {
  contentHash,
  markEvaluated,
  readEvalMarks,
  readSavedEvaluation,
  saveEvaluation,
  type Change,
  type Evaluation,
} from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

const result = fixture.CHG0031001 as unknown as Evaluation;

const change = {
  number: "CHG0031001",
  implementation_plan: "Passo 1",
  validation_plan: "Conferir",
  objective: "Objetivo",
  benefits: "Benefícios",
  test_justification: "Testado",
  short_description: "Título",
  prerequisites: "Nada",
  backout_plan: "Voltar",
  tasks: [{ number: "CTASK1", short_description: "Fazer" }],
} as unknown as Change;

afterEach(() => sessionStorage.clear());

describe("saved evaluation", () => {
  it("reopens the last result for the same text", () => {
    saveEvaluation(change, { edits: {}, model: "m", result, at: 1000 });
    const saved = readSavedEvaluation(change);
    expect(saved?.result.overall).toBe(result.overall);
    expect(saved?.at).toBe(1000);
  });

  it("keeps the edits the result was read with", () => {
    const edits = { objective: "Outro objetivo" };
    saveEvaluation(change, { edits, model: "m", result, at: 1 });
    expect(readSavedEvaluation(change)?.edits).toEqual(edits);
  });

  it("drops the result when the Change itself changed on the server", () => {
    saveEvaluation(change, { edits: {}, model: "m", result, at: 1 });
    expect(readSavedEvaluation({ ...change, backout_plan: "Outro" })).toBeNull();
  });

  it("the hash reads every text the AI reads", () => {
    const a = contentHash(change, {});
    expect(contentHash(change, { objective: "x" })).not.toBe(a);
    expect(
      contentHash(
        {
          ...change,
          tasks: [{ number: "CTASK1", short_description: "Outra" }],
        } as Change,
        {},
      ),
    ).not.toBe(a);
  });

  it("ignores a stored value that is not an evaluation", () => {
    sessionStorage.setItem("is-eval:CHG0031001", '{"hash":"x","result":{"foo":1}}');
    expect(readSavedEvaluation(change)).toBeNull();
    sessionStorage.setItem("is-eval:CHG0031001", "{quebrado");
    expect(readSavedEvaluation(change)).toBeNull();
  });
});

describe("evaluation marks", () => {
  it("drop malformed marks instead of breaking the list", () => {
    sessionStorage.setItem(
      "is-evaluated",
      JSON.stringify({ CHG1: {}, CHG2: { overall: "9", passed: true }, CHG3: null }),
    );
    expect(readEvalMarks()).toEqual({});
  });

  it("say when the text was edited", () => {
    markEvaluated("CHG1", { overall: 9.2, passed: true, ok: true, edited: true });
    expect(readEvalMarks().CHG1).toMatchObject({ overall: 9.2, edited: true });
  });
});

describe("score colour (auditoria P1-5)", () => {
  it("colours by the number shown: 7,96 reads 8,0 and is green", async () => {
    const { band } = await import("@/lib/changes");
    expect(band(7.96)).toBe("good");
    expect(band(7.94)).toBe("mid");
    expect(band(4.96)).toBe("mid");
  });
});

describe("average colour", () => {
  it("7,96 shown with two places stays under the cut", async () => {
    const { band } = await import("@/lib/changes");
    expect(band(7.96, 2)).toBe("mid");
  });
});
