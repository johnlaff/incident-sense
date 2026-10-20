import { describe, expect, it } from "vitest";

import {
  causeSummary,
  isProblemNumber,
  problemState,
  problemsForGroup,
  type ProblemSummary,
} from "@/lib/problems";

function prb(number: string, linked: string[]): ProblemSummary {
  return {
    number,
    short_description: number,
    root_cause: "causa",
    state: "Resolvido",
    category: "Pagamentos",
    subcategory: "Pix",
    cmdb_ci: "PIX-Core",
    assignment_group: "Sustentacao-Pagamentos",
    opened_at: "2026-02-03T10:00:00",
    resolved_at: null,
    tags: [],
    linked_incidents: linked,
  };
}

describe("isProblemNumber", () => {
  it("tells a Problem from an incident", () => {
    expect(isProblemNumber("PRB0004101")).toBe(true);
    expect(isProblemNumber("INC0051968")).toBe(false);
    expect(isProblemNumber("PRB")).toBe(false);
  });
});

describe("problemState", () => {
  it("maps the two states to a tone and a label", () => {
    expect(problemState("Resolvido")).toEqual({ tone: "resolved", label: "Resolvido" });
    expect(problemState("Erro conhecido")).toEqual({
      tone: "known",
      label: "Erro conhecido",
    });
  });
});

describe("problemsForGroup", () => {
  const all = [
    prb("PRB2", ["INC1", "INC2"]),
    prb("PRB1", ["INC1", "INC2", "INC3"]),
    prb("PRB3", ["INC3", "INC8", "INC9"]),
  ];

  it("keeps Problems whose incidents fall mostly in the group, most matched first", () => {
    expect(problemsForGroup(all, ["INC1", "INC2", "INC3"]).map((p) => p.number)).toEqual([
      "PRB1",
      "PRB2",
    ]);
  });

  it("returns nothing for a group no Problem explains", () => {
    expect(problemsForGroup(all, ["INC7"])).toEqual([]);
  });
});

describe("causeSummary", () => {
  it("keeps the first clause whole, never an ellipsis", () => {
    expect(
      causeSummary(
        "Pool de threads do PIX-Core dimensionado para o volume médio; o timeout do cliente HTTP estava abaixo.",
      ),
    ).toBe("Pool de threads do PIX-Core dimensionado para o volume médio.");
    expect(
      causeSummary("Renovação de certificado manual, sem alerta de expiração."),
    ).toBe("Renovação de certificado manual, sem alerta de expiração.");
  });
});
