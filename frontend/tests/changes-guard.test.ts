import { describe, expect, it } from "vitest";

import { isEvaluation } from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

describe("isEvaluation", () => {
  it("accepts a real evaluation response", () => {
    for (const ev of Object.values(fixture)) expect(isEvaluation(ev)).toBe(true);
  });

  it("rejects a response without fields, so the screen shows its error state", () => {
    const { fields: _drop, ...rest } = Object.values(fixture)[0] as Record<
      string,
      unknown
    >;
    expect(isEvaluation(rest)).toBe(false);
    expect(isEvaluation({ detail: "Bad gateway" })).toBe(false);
    expect(isEvaluation(null)).toBe(false);
    expect(isEvaluation("<html>")).toBe(false);
  });
});
