import { describe, expect, it } from "vitest";

import {
  BEATS,
  beatsFor,
  citationSource,
  citationSummary,
  formatSim,
  layerCounts,
  layerShown,
  mergeNotes,
  retrievalRows,
  stepReveal,
  stepViews,
  wordCount,
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

describe("stepViews", () => {
  it("folds the backend steps into the seven-step vocabulary", () => {
    const views = stepViews(suggestFixture());
    expect(views.map((v) => v.title)).toEqual([
      "Carregar",
      "Resumir",
      "Transformar em números",
      "Buscar e conferir",
      "Classificar",
      "Sugerir",
      "Publicar",
    ]);
    // "contexto" closes step 4; the procedência gate is step 5.
    expect(views[3].decisions).toEqual(["Contexto."]);
    expect(views[4]).toMatchObject({ gate: true, decisions: ["Procedente."] });
    // Steps the run did not report read as not applicable.
    expect(views[1].status).toBe("pulada");
  });

  it("a degraded part degrades the whole step", () => {
    const res = suggestFixture();
    res.steps.push({
      id: "recuperar",
      order: 4,
      title: "x",
      status: "degradada",
      decision: "Pós-filtro indisponível.",
      gate: false,
    });
    expect(stepViews(res)[3].status).toBe("degradada");
  });
});

describe("the replay beats", () => {
  it("reveals one step after the other, step 4 in three layers", () => {
    expect(BEATS).toHaveLength(9);
    expect(stepReveal("carregar", -1)).toBe("hidden");
    expect(stepReveal("carregar", 0)).toBe("current");
    expect(stepReveal("carregar", 1)).toBe("done");
    expect(stepReveal("buscar", 3)).toBe("current");
    expect(stepReveal("buscar", 5)).toBe("current");
    expect(stepReveal("buscar", 6)).toBe("done");
    expect(layerShown("vetor", 3)).toBe(false);
    expect(layerShown("vetor", 4)).toBe(true);
    expect(layerShown("conferir", 5)).toBe(true);
  });

  it("captions take the real vector size and floor, without em dashes", () => {
    const beats = beatsFor(3072, 0.8);
    expect(beats[2].caption).toContain("3.072 números");
    expect(beats[4].caption).toContain("Abaixo de 0,80");
    expect(beatsFor(1536, 0.75)[4].caption).toContain("0,75");
    for (const b of BEATS) {
      expect(b.caption).not.toMatch(/[\u2014\u2013]/);
      expect(b.caption.length).toBeLessThanOrEqual(110);
    }
  });
});

describe("wordCount and citationSource", () => {
  it("counts words and ties a citation to its search row", () => {
    expect(wordCount("  Pix  debitado sem comprovante ")).toBe(4);
    expect(wordCount("")).toBe(0);
    const src = citationSource("INC0051986", suggestFixture());
    expect(src.row?.outcome).toBe("mantido");
    expect(src.inContext).toBe(true);
    expect(citationSource("INC9", suggestFixture()).row).toBeNull();
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
    author: "Assistente da IA",
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
