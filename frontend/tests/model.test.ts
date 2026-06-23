import { describe, expect, it } from "vitest";

import { buildQuery } from "@/lib/api";
import {
  clusterColor,
  dsState,
  mapSuggest,
  mapSummary,
  parseSuggestion,
  pCode,
  segmentsToPlain,
  type SuggestionSegment,
} from "@/lib/model";
import type { IncidentSummary, SuggestResponse } from "@/lib/types";

const cites = (segs: SuggestionSegment[]) =>
  segs.filter((s): s is { cite: string } => "cite" in s).map((s) => s.cite);

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

describe("parseSuggestion + segmentsToPlain", () => {
  it("turns [INC…] tokens into citation segments", () => {
    const segs = parseSuggestion(
      "Escale [INC0051986] e ajuste o timeout INC0051908.",
      [],
    );
    expect(cites(segs)).toEqual(["INC0051986", "INC0051908"]);
  });

  it("appends referenced incidents as sources when none are inline", () => {
    const segs = parseSuggestion("Reinicie o serviço.", ["INC0001234", "INC0005678"]);
    expect(cites(segs)).toEqual(["INC0001234", "INC0005678"]);
  });

  it("round-trips citations back to [INC…] plain text", () => {
    expect(segmentsToPlain([{ text: "Veja " }, { cite: "INC0001" }, { text: "." }])).toBe(
      "Veja [INC0001].",
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
    expect(r.suggestion).not.toBeNull();
    expect(cites(r.suggestion ?? [])).toEqual(["INC0051986", "INC0051908"]);
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
