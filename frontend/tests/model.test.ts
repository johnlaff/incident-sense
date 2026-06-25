import { describe, expect, it } from "vitest";

import { buildQuery } from "@/lib/api";
import {
  buildSuggestionMarkdown,
  clusterColor,
  dsState,
  enforceNumberedSteps,
  mapSuggest,
  mapSummary,
  markdownToPlain,
  normalizeSuggestionSpacing,
  pCode,
} from "@/lib/model";
import type { IncidentSummary, SuggestResponse } from "@/lib/types";

describe("state + priority mapping", () => {
  it("maps backend states to the DS vocabulary", () => {
    expect(dsState("New")).toBe("open");
    expect(dsState("In Progress")).toBe("progress");
    expect(dsState("On Hold")).toBe("hold");
    expect(dsState("Resolved")).toBe("resolved");
    expect(dsState("Closed")).toBe("resolved");
    expect(dsState("???")).toBe("open");
  });

  it("maps numeric priority to p-codes (clamped)", () => {
    expect(pCode(1)).toBe("p1");
    expect(pCode(4)).toBe("p4");
    expect(pCode(9)).toBe("p4");
    expect(pCode(0)).toBe("p1");
  });
});

describe("mapSummary", () => {
  const summary: IncidentSummary = {
    number: "INC0001",
    short_description: "Pix lento",
    category: "Pagamentos",
    cmdb_ci: "PIX-Core",
    assignment_group: "Sustentacao-Pagamentos",
    priority: 2,
    state: "In Progress",
    opened_at: new Date().toISOString(),
    resolved_at: null,
    is_resolved: false,
    tags: ["pix"],
  };

  it("renames fields to the DS view model", () => {
    const row = mapSummary(summary);
    expect(row.service).toBe("PIX-Core");
    expect(row.group).toBe("Sustentacao-Pagamentos");
    expect(row.state).toBe("progress");
    expect(row.priority).toBe("p2");
    expect(row.isResolved).toBe(false);
    expect(row.rel.startsWith("há")).toBe(true);
  });
});

describe("buildSuggestionMarkdown", () => {
  it("keeps the markdown untouched when it already cites inline", () => {
    const md = buildSuggestionMarkdown("Escale [INC0051986] e ajuste o timeout.", [
      "INC0051986",
    ]);
    expect(md).toBe("Escale [INC0051986] e ajuste o timeout.");
  });

  it("appends referenced incidents as sources when none are inline", () => {
    const md = buildSuggestionMarkdown("Reinicie o serviço.", [
      "INC0001234",
      "INC0005678",
    ]);
    expect(md).toContain("Fundamentado em [INC0001234] e [INC0005678].");
  });

  it("leaves the body alone when there is nothing to reference", () => {
    expect(buildSuggestionMarkdown("Reinicie o serviço.", [])).toBe("Reinicie o serviço.");
  });
});

describe("normalizeSuggestionSpacing", () => {
  it("puts a blank line before each step so the list breathes", () => {
    const cramped = "Diagnóstico curto.\n1. **A** — x [INC0001].\n2. **B** — y [INC0002].";
    expect(normalizeSuggestionSpacing(cramped)).toBe(
      "Diagnóstico curto.\n\n1. **A** — x [INC0001].\n\n2. **B** — y [INC0002].",
    );
  });

  it("separates bold-led action paragraphs the model glued together", () => {
    const glued = "Diagnóstico.\n**Ação um** — detalhe.\n**Ação dois** — detalhe.";
    expect(normalizeSuggestionSpacing(glued)).toBe(
      "Diagnóstico.\n\n**Ação um** — detalhe.\n\n**Ação dois** — detalhe.",
    );
  });

  it("collapses runs of blank lines and does not touch a single paragraph", () => {
    expect(normalizeSuggestionSpacing("Apenas um parágrafo.")).toBe("Apenas um parágrafo.");
  });
});

describe("enforceNumberedSteps", () => {
  it("numbers bold-led action paragraphs the model left unnumbered", () => {
    const md = "Diagnóstico.\n\n**Ação um** — x [INC0001].\n\n**Ação dois** — y [INC0002].";
    expect(enforceNumberedSteps(md)).toBe(
      "Diagnóstico.\n\n1. **Ação um** — x [INC0001].\n\n2. **Ação dois** — y [INC0002].",
    );
  });

  it("leaves an already-numbered list untouched", () => {
    const md = "Diagnóstico.\n\n1. **Ação um** — x.\n\n2. **Ação dois** — y.";
    expect(enforceNumberedSteps(md)).toBe(md);
  });

  it("does not number a single action or plain prose", () => {
    const md = "Diagnóstico.\n\n**Ação única** — x.";
    expect(enforceNumberedSteps(md)).toBe(md);
  });

  it("never numbers the diagnosis even when the model bolds it", () => {
    const md = "**Diagnóstico em negrito.**\n\n**Ação um** — x.\n\n**Ação dois** — y.";
    expect(enforceNumberedSteps(md)).toBe(
      "**Diagnóstico em negrito.**\n\n1. **Ação um** — x.\n\n2. **Ação dois** — y.",
    );
  });
});

describe("markdownToPlain", () => {
  it("strips bold/code markers for the resolution notes", () => {
    expect(markdownToPlain("1. **Ação** com `code` e [INC0001].")).toBe(
      "1. Ação com code e [INC0001].",
    );
  });
});

describe("mapSuggest", () => {
  const base: SuggestResponse = {
    summarized_query: "Pix sem comprovante",
    classification: "PROCEDENTE",
    suggestion: "Aumentar workers [INC0051986] e ajustar timeout [INC0051908].",
    candidates: [
      {
        number: "INC0051986",
        short_description: "Pix pendente",
        cmdb_ci: "PIX-Core",
        category: "Pagamentos",
        similarity: 0.71,
        resolution_notes: "Escalado o pool.",
        close_code: null,
        survived_postfilter: true,
        postfilter_reason: null,
      },
      {
        number: "INC0052071",
        short_description: "IB lento",
        cmdb_ci: "Internet-Banking-Web",
        category: "Canais",
        similarity: 0.58,
        resolution_notes: null,
        close_code: null,
        survived_postfilter: false,
        postfilter_reason: "Outro serviço e outra causa.",
      },
    ],
    referenced_incidents: ["INC0051986", "INC0051908"],
  };

  it("maps a PROCEDENTE result with grounded citations", () => {
    const r = mapSuggest(base);
    expect(r.verdict).toBe("PROCEDENTE");
    expect(r.neighbors).toBe(2);
    expect(r.candidates[0].keep).toBe(true);
    expect(r.candidates[1].keep).toBe(false);
    expect(r.candidates[1].reason).toBe("Outro serviço e outra causa.");
    expect(r.suggestion).toContain("INC0051986");
    expect(r.suggestion).toContain("INC0051908");
    expect(r.noBase).toBe(false);
  });

  it("returns no suggestion for IMPROCEDENTE", () => {
    const r = mapSuggest({
      ...base,
      classification: "IMPROCEDENTE",
      suggestion: null,
      candidates: [],
      referenced_incidents: [],
    });
    expect(r.verdict).toBe("IMPROCEDENTE");
    expect(r.suggestion).toBeNull();
  });

  it("flags noBase when PROCEDENTE but nothing grounds it", () => {
    const r = mapSuggest({
      ...base,
      suggestion: null,
      candidates: [],
      referenced_incidents: [],
    });
    expect(r.noBase).toBe(true);
  });
});

describe("clusterColor", () => {
  it("greys out outliers and colors real clusters", () => {
    expect(clusterColor(-1, false)).toContain("0.012");
    expect(clusterColor(0, true)).toContain("0.012");
    expect(clusterColor(1, false)).toMatch(/^oklch\(/);
  });
});

describe("buildQuery", () => {
  it("is empty for default params", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ state: "all" })).toBe("");
  });

  it("encodes the active filters", () => {
    const qs = buildQuery({ state: "open", service: "PIX-Core", q: "pix", offset: 50 });
    expect(qs.startsWith("?")).toBe(true);
    expect(qs).toContain("state=open");
    expect(qs).toContain("service=PIX-Core");
    expect(qs).toContain("offset=50");
  });
});
