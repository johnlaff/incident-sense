// Bug report (22/10): typing in the chat before any analysis started the whole
// analysis on its own. A question never runs the analysis unasked: with no
// analysis on screen, the chat says so and offers "Analisar o incidente".
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { NO_ANALYSIS, afterAskError, inputHint, type Turn } from "@/lib/followup";

const turn = (over: Partial<Turn> = {}): Turn => ({
  id: 1,
  question: "Quem é vc?",
  state: "running",
  res: null,
  error: null,
  ...over,
});

const noAnalysis = () => new ApiError(409, "Ainda não há análise.");

describe("a question with no analysis on screen", () => {
  it("does not run the analysis by itself", () => {
    const next = afterAskError(turn(), noAnalysis(), false);
    expect(next.reanalyze).toBe(false);
    expect(next.turn.state).toBe("error");
  });

  it("says why and offers the analysis as a choice", () => {
    const next = afterAskError(turn(), noAnalysis(), false);
    expect(next.turn.error).toBe(NO_ANALYSIS);
    expect(next.turn.needsAnalysis).toBe(true);
    expect(next.turn.firstAnalysis).toBe(true);
    expect(NO_ANALYSIS).not.toMatch(/409|reinici/i);
  });

  it("the field does not promise an analysis before the question", () => {
    expect(inputHint(null)).not.toMatch(/analisa/i);
  });
});

describe("a question under an analysis the server lost (restart)", () => {
  it("still re-syncs once, since the person already asked for that analysis", () => {
    const next = afterAskError(turn(), noAnalysis(), true);
    expect(next.reanalyze).toBe(true);
    expect(next.turn.firstAnalysis).toBeFalsy();
  });
});
