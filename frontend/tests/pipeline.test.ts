import { describe, expect, it } from "vitest";

import {
  citationSummary,
  formatSim,
  layerCounts,
  mergeNotes,
  orderedSteps,
  retrievalRows,
  stepMarker,
} from "@/lib/pipeline";
import type { WorkNote } from "@/lib/types";

import { suggestFixture } from "./suggest-fixture";

describe("retrievalRows", () => {
  it("tells, per record, which layer kept or dropped it", () => {
    const rows = retrievalRows(suggestFixture(), "incidente");
    expect(rows.map((r) => [r.number, r.outcome])).toEqual([
      ["INC0051986", "mantido"],
      ["INC0051908", "descartado"],
      ["INC0051919", "abaixo"],
    ]);
    expect(rows[1].reason).toBe("outra causa");
    expect(rows[2].reason).toBeNull();
    expect(layerCounts(rows)).toEqual({ passed: 2, total: 3, kept: 1, dropped: 1 });
  });

  it("marks kept records as the original list when the post-filter failed", () => {
    const res = suggestFixture();
    res.retrieval.postfilter = {
      ...res.retrieval.postfilter,
      status: "fallback",
      verdicts: res.retrieval.postfilter.verdicts.map((v) => ({ ...v, kept: true })),
    };
    const rows = retrievalRows(res, "problema");
    expect(rows[0].outcome).toBe("mantido-fallback");
  });
});

describe("orderedSteps", () => {
  it("orders by step number with the gate after the context", () => {
    const steps = orderedSteps(suggestFixture());
    expect(steps.map((s) => s.id)).toEqual([
      "carregar",
      "contexto",
      "decidir",
      "publicar",
    ]);
    expect(steps.map(stepMarker)).toEqual(["1", "5", "?", "7"]);
  });
});

describe("citationSummary", () => {
  it("confirms when every citation is grounded", () => {
    expect(citationSummary([])).toBe("Todas as citações estão no contexto recuperado.");
  });

  it("counts removed and flagged citations", () => {
    expect(
      citationSummary([
        { id: "INC1", action: "removida" },
        { id: "INC2", action: "removida" },
        { id: "INC3", action: "sinalizada" },
      ]),
    ).toBe("3 citações fora do contexto: 2 removidas e 1 sinalizada.");
  });
});

describe("mergeNotes", () => {
  const note: WorkNote = {
    id: "n1",
    incident_number: "INC1",
    author: "Aurora",
    text: "x",
    sources: [],
    model: null,
    created_at: "2026-10-19T10:00:00Z",
  };

  it("appends a freshly published note once", () => {
    expect(mergeNotes([], note)).toEqual([note]);
    expect(mergeNotes([note], note)).toEqual([note]);
    expect(mergeNotes([note], null)).toEqual([note]);
  });
});

describe("formatSim", () => {
  it("uses the PT-BR comma and never rounds a miss up to the floor", () => {
    expect(formatSim(0.8043)).toBe("0,80");
    expect(formatSim(0.79995)).toBe("0,79");
    expect(formatSim(0.8)).toBe("0,80");
  });
});
