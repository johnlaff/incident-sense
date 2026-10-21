// E2E rodada 3: the assistant answers what the person typed (P1-2) and lists
// every source the answer stands on, the Problems too (P1-3).
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { askNote, followUpBody, inputHint } from "@/lib/followup";
import { mapSuggest } from "@/lib/model";
import type { AskResponse, RetrievedCandidate, RetrievedProblem } from "@/lib/types";

import { suggestFixture } from "./suggest-fixture";

afterEach(() => vi.unstubAllGlobals());

const inc = (number: string, similarity: number): RetrievedCandidate => ({
  number,
  short_description: `caso ${number}`,
  cmdb_ci: "App",
  category: "Canais",
  similarity,
  resolution_notes: "r",
  survived_postfilter: true,
});
const prb = (number: string, similarity: number): RetrievedProblem => ({
  number,
  short_description: `problema ${number}`,
  root_cause: "causa",
  workaround: "contorno",
  permanent_fix: "fix",
  linked_incidents: 16,
  similarity,
  survived_postfilter: true,
});

const res = suggestFixture({
  candidates: ["INC0052228", "INC0052273", "INC0052219", "INC0052209", "INC0052171"].map(
    (n, i) => inc(n, 0.97 - i * 0.005),
  ),
  problems: [prb("PRB0004105", 0.9), prb("PRB0004104", 0.84)],
  context_ids: [
    "INC0052228",
    "INC0052273",
    "INC0052219",
    "INC0052209",
    "INC0052171",
    "PRB0004105",
    "PRB0004104",
  ],
});

describe("P1-3: one list of sources, Problems included", () => {
  it("lists the 5 incidents and the 2 Problems the answer stands on", () => {
    const r = mapSuggest(res);
    expect(r.sources.map((s) => s.id)).toEqual(res.context_ids);
    expect(r.sources.filter((s) => s.kind === "problema").map((s) => s.sim)).toEqual([
      0.9, 0.84,
    ]);
  });
});

describe("P1-2: a typed question is a follow-up, not a new analysis", () => {
  it("sends the question with the kept cases of the analysis", () => {
    expect(followUpBody(res, "  Qual é a prioridade?  ", "haiku")).toEqual({
      question: "Qual é a prioridade?",
      context_ids: res.context_ids,
      model: "haiku",
    });
  });

  it("posts to the follow-up route, not to /api/suggest", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          kind: "answer",
          answer: "a",
          citations: { cited: [], flagged: [] },
          context_ids: [],
        }),
    });
    vi.stubGlobal("fetch", fetch);
    await api.askIncident("INC0052233", { question: "q", context_ids: ["INC1"] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/incidents\/INC0052233\/ask$/);
    expect(url).not.toMatch(/suggest/);
    expect(JSON.parse(init.body)).toEqual({ question: "q", context_ids: ["INC1"] });
  });

  it("says plainly when the cases do not answer, and what an answer stands on", () => {
    const answer = (over: Partial<AskResponse>): AskResponse => ({
      kind: "answer",
      answer: "x",
      citations: { cited: [], flagged: [] },
      context_ids: ["PRB0004105"],
      ...over,
    });
    expect(askNote(answer({ kind: "not_in_cases" }))).toMatch(/não respondem/);
    expect(askNote(answer({ citations: { cited: ["PRB0004105"], flagged: [] } }))).toBe(
      "Com base em PRB0004105.",
    );
    expect(askNote(answer({}))).toMatch(/Sem caso citado/);
    expect(askNote(answer({ kind: "off_topic" }))).toBeNull();
  });

  it("the input says what it does before and after the analysis", () => {
    expect(inputHint(null)).toMatch(/analisa/);
    expect(inputHint(res)).toMatch(/sugestão/);
  });
});
