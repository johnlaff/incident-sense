// Auditorias da rodada 4 (bugs-logica-4.md e bugs-e2e-4.md): a long question
// never reaches the screen as an object, the chat keeps every question and
// says only what the analysis has, and the Change screens name fields and
// colours the way the verdict does.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Coherence, STILL } from "@/app/changes/evaluation";
import { buildSteps, rerunHint, verdictOf } from "@/app/changes/sequence";
import { api, ApiError, errorDetail } from "@/lib/api";
import {
  askNote,
  followUpBody,
  inputHint,
  QUESTION_MAX,
  questionCount,
  readChat,
  saveChat,
  settleTurns,
  upsertTurn,
  type Turn,
} from "@/lib/followup";
import { mergeNotes } from "@/lib/pipeline";
import type { Evaluation, FieldKey, FieldScore, SemanticAnalysis } from "@/lib/changes";
import type { AskResponse, WorkNote } from "@/lib/types";

import { suggestFixture } from "./suggest-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The declarations of every rule whose selector list holds `selector`. */
function rules(selector: string): string {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    const sels = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join("\n");
}

const TOO_LONG = [
  {
    type: "string_too_long",
    loc: ["body", "question"],
    msg: "String should have at most 600 characters",
    input: "x".repeat(700),
    ctx: { max_length: 600 },
  },
];

describe("logica-4 P1-1: a validation error is a sentence, never an object", () => {
  it("turns the 422 of a long question into PT-BR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ detail: TOO_LONG }),
      }),
    );
    const error = await api
      .askIncident("INC0052233", { question: "x".repeat(700), context_ids: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(typeof (error as ApiError).detail).toBe("string");
    expect((error as ApiError).detail).toMatch(/pergunta/i);
    expect((error as ApiError).detail).toMatch(/600 caracteres/);
  });

  it("every caller gets a string: other fields, objects and numbers too", () => {
    const fields = errorDetail(422, [
      { type: "missing", loc: ["body", "fields"], msg: "Field required" },
    ]);
    expect(fields).toMatch(/recusou/);
    expect(fields).not.toMatch(/Field required|\[object/);
    expect(errorDetail(400, { msg: "x" })).toMatch(/erro 400/);
    expect(errorDetail(500, 42)).toMatch(/erro 500/);
    expect(errorDetail(503, "sem chaves")).toBe("sem chaves");
    expect(errorDetail(500, "Internal Server Error")).toMatch(/erro 500/);
  });

  it("the field stops at 600 and counts near the end", () => {
    expect(QUESTION_MAX).toBe(600);
    expect(questionCount(10)).toBeNull();
    expect(questionCount(540)).toBe("540/600");
    expect(questionCount(600)).toBe("600/600");
  });
});

const answer = (over: Partial<AskResponse> = {}): AskResponse => ({
  kind: "answer",
  answer: "x",
  citations: { cited: [], flagged: [] },
  context_ids: ["INC0051986"],
  ...over,
});

describe("logica-4 P2-6 and e2e-4 P2-4/5: the chat says only what the analysis has", () => {
  const procedente = suggestFixture();
  const improcedente = suggestFixture({
    classification: "IMPROCEDENTE",
    suggestion: null,
    context_ids: [],
  });
  const semBase = suggestFixture({ suggestion: null, context_ids: [] });

  it("never offers a suggestion that is not there", () => {
    expect(inputHint(procedente)).toMatch(/sugestão/);
    expect(inputHint(improcedente)).not.toMatch(/sugestão|casos/);
    expect(inputHint(semBase)).not.toMatch(/sugestão/);
  });

  it("fits a 360 px phone field (32 characters at most)", () => {
    for (const hint of [
      inputHint(null),
      inputHint(procedente),
      inputHint(improcedente),
      inputHint(semBase),
    ])
      expect(hint.length).toBeLessThanOrEqual(32);
  });

  it("an analysis with no cases says so instead of 'os casos não respondem'", () => {
    expect(askNote(answer({ kind: "not_in_cases", context_ids: [] }))).toMatch(
      /não usou casos parecidos/,
    );
    expect(askNote(answer({ context_ids: [] }))).toMatch(/não usou casos parecidos/);
    expect(askNote(answer({ kind: "not_in_cases" }))).toMatch(/não respondem/);
  });

  it("a question before any analysis is sent too: the server decides", () => {
    expect(followUpBody(null, "  oi  ")).toEqual({ question: "oi", context_ids: [] });
  });
});

const turn = (id: number, state: Turn["state"], question = `q${id}`): Turn => ({
  id,
  question,
  state,
  res: state === "done" ? answer() : null,
  error: state === "error" ? "falhou" : null,
});

describe("logica-4 P2-3/P2-4/P2-14: no question is lost or moved", () => {
  it("retrying a question keeps it where it was", () => {
    const turns = [turn(1, "error"), turn(2, "done")];
    const next = upsertTurn(turns, { ...turns[0], state: "running", error: null });
    expect(next.map((t) => [t.id, t.state])).toEqual([
      [1, "running"],
      [2, "done"],
    ]);
    expect(upsertTurn(next, turn(3, "waiting")).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("a question waiting for a failed analysis stays, to be asked after the retry", () => {
    const turns = [turn(1, "waiting")];
    expect(settleTurns(turns, "error")).toEqual({ keep: turns, ask: [] });
    expect(settleTurns(turns, "running")).toEqual({ keep: turns, ask: [] });
    expect(settleTurns(turns, "done").ask.map((t) => t.id)).toEqual([1]);
  });
});

describe("e2e-4 P2-3: the analysis and the chat come back within the session", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the answered turns and the analysis per incident", () => {
    const res = suggestFixture();
    saveChat("INC0052233", {
      response: res,
      durationMs: 1200,
      model: "m",
      turns: [turn(1, "done"), turn(2, "running"), turn(3, "waiting"), turn(4, "error")],
    });
    const back = readChat("INC0052233")!;
    expect(back.response).toEqual(res);
    expect(back.turns.map((t) => [t.id, t.state])).toEqual([
      [1, "done"],
      [4, "error"],
    ]);
    expect(readChat("INC0053084")).toBeNull();
  });

  it("ignores what it cannot read", () => {
    window.sessionStorage.setItem("incident-sense:chat:INC0052233", "{not json");
    expect(readChat("INC0052233")).toBeNull();
    window.sessionStorage.setItem(
      "incident-sense:chat:INC0052233",
      JSON.stringify({ response: { x: 1 }, turns: [] }),
    );
    expect(readChat("INC0052233")).toBeNull();
  });

  it("a second analysis replaces the AI note in place", () => {
    const note = (text: string): WorkNote =>
      ({ id: "n1", author: "IA", text, created_at: "2026-10-21T10:00:00Z" }) as WorkNote;
    const merged = mergeNotes([note("antes")], note("depois"));
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("depois");
  });
});

describe("e2e-4 P2-8: long words stay inside the bubbles", () => {
  it("wraps anywhere in the person's and the AI's follow-up bubbles", () => {
    expect(rules(".bubble-user")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rules(".bubble-ai.followup")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("e2e-4 P2-6: the assistant button never covers the record's text", () => {
  it("with the full rail, it sits in the rail, not over the record", () => {
    const at = CSS.indexOf("@media (min-width: 921px) {");
    const block = CSS.slice(at, CSS.indexOf("\n}\n", at));
    const fab = block.slice(block.indexOf(".cop-fab {"));
    expect(fab).toMatch(/left:\s*20px/);
    expect(fab).toMatch(/right:\s*auto/);
  });
});

/* ---------------------------------------------------------------- Changes */

const WEIGHTS: [FieldKey, string, number][] = [
  ["implementation_plan", "Plano de implementação", 2.5],
  ["validation_plan", "Plano de validação", 2.5],
  ["objective", "Objetivo", 2],
  ["benefits", "Benefícios", 2],
  ["test_justification", "Justificativa dos testes", 2],
  ["short_description", "Descrição resumida", 1.5],
  ["prerequisites", "Pré-requisitos", 1],
];

function fields(
  score = 9.2,
  over: Partial<Record<FieldKey, Partial<FieldScore>>> = {},
): FieldScore[] {
  return WEIGHTS.map(([key, label, weight]) => ({
    key,
    label,
    weight,
    score,
    diagnosis: "d",
    guidance: "",
    reused: false,
    content_hash: key,
    ...over[key],
  }));
}

function sem(over: Partial<SemanticAnalysis> = {}): SemanticAnalysis {
  return {
    consistency_score: 9,
    problems: [],
    reasoning: "r",
    guidance: "",
    backout_adherence: "ADERENTE",
    backout_adherence_percent: 90,
    reused: false,
    ...over,
  };
}

function ev(over: Partial<Evaluation> = {}): Evaluation {
  return {
    number: "CHG0031002",
    rubric_version: "v",
    scope: { in_scope: true, reason: "" },
    fields: fields(),
    overall: 9.2,
    threshold: 8,
    semantic: sem(),
    semantic_skipped_reason: null,
    model: "m",
    model_calls: 8,
    duration_ms: 1000,
    ...over,
  };
}

describe("logica-4 P2-10: two missing fields read 'Objetivo e Benefícios'", () => {
  it("in the verdict and in the gate step", () => {
    const e = ev({
      fields: fields(6, {
        objective: { score: null, failed: true },
        benefits: { score: null, failed: true },
      }),
      semantic: null,
    });
    expect(verdictOf(e)!.reason).toMatch(/Objetivo e Benefícios/);
    const portao = buildSteps(e).find((s) => s.id === "portao")!;
    expect(portao.caption).toMatch(/Objetivo e Benefícios/);
    expect(portao.caption).not.toMatch(/Objetivo, Benefícios/);
  });
});

describe("logica-4 P2-7: back to a text the AI already read is not 'nada mudou'", () => {
  it("names the field that went back to a graded text", () => {
    const first = ev({ fields: fields(9, { objective: { content_hash: "a" } }) });
    const second = ev({
      fields: fields(9, { objective: { content_hash: "b" } }).map((f) => ({
        ...f,
        reused: f.key !== "objective",
      })),
    });
    const back = ev({
      fields: fields(9, { objective: { content_hash: "a" } }).map((f) => ({
        ...f,
        reused: true,
      })),
    });
    expect(buildSteps(second, first)[0].caption).not.toMatch(/Nada mudou/);
    const notas = buildSteps(back, second)[0].caption;
    expect(notas).not.toMatch(/Nada mudou/);
    expect(notas).toMatch(/Objetivo voltou a um texto que a IA já tinha avaliado/);
  });

  it("before the run, says the field goes back to the grade it had", () => {
    expect(rerunHint({ dirty: 0, recalled: 1, modelChanged: false, total: 7 })).toMatch(
      /já tinha avaliado/,
    );
    expect(
      rerunHint({ dirty: 0, recalled: 1, modelChanged: false, total: 7 }),
    ).not.toMatch(/Só ele volta para a IA/);
  });
});

describe("e2e-4 P2-7: the last aula step of CHG0031002 says where the points are", () => {
  it("points to 'Ver onde' when the coherence points are not on screen", () => {
    const e = ev({
      semantic: sem({ consistency_score: 6, problems: ["a", "b"] }),
      decision: {
        passes: false,
        reason_code: "coherence_below",
        reason: "x",
        failed: ["coherence_below"],
      },
    });
    const last = buildSteps(e).at(-1)!;
    expect(last.id).toBe("problemas");
    expect(last.caption).toMatch(/Ver onde/);
  });
});

describe("e2e-4 P2-8: a failing 6,0 has one colour", () => {
  it("the coherence card draws it red, like question 2", async () => {
    const e = ev({
      semantic: sem({ consistency_score: 6, problems: ["a"] }),
      decision: {
        passes: false,
        reason_code: "coherence_below",
        reason: "x",
        failed: ["coherence_below"],
      },
    });
    const steps = buildSteps(e);
    const { container } = render(
      <Coherence result={e} index={steps.length} steps={steps} skipped motion={STILL} />,
    );
    const chip = container.querySelector(".chg-sem-tile > :first-child")!;
    await waitFor(() => expect(chip.className).toMatch(/\blow\b/));
  });
});

describe("logica-4 P2-9: an unreachable average never asks to evaluate again", () => {
  it("the locked coherence card drops the old 'falta X. Avalie de novo.'", () => {
    const e = ev({
      fields: fields(6, { objective: { score: null, failed: true } }),
      semantic: null,
      semantic_skipped_reason:
        "A conferência de coerência espera todas as notas: falta Objetivo. Avalie de novo.",
      decision: {
        passes: false,
        reason_code: "average_below",
        reason: "x",
        failed: ["average_below"],
      },
    });
    const steps = buildSteps(e);
    const { container } = render(
      <Coherence result={e} index={steps.length} steps={steps} skipped motion={STILL} />,
    );
    expect(container.textContent).not.toMatch(/Avalie de novo/);
  });
});
