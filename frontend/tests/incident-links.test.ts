// Auditoria P1-15, P2-16 and E2E P1-2, P1-3: what an incident page links to.
import { describe, expect, it } from "vitest";

import { linkedProblem, recurrenceView, relatedNumbers } from "@/lib/model";

describe("recurrenceView", () => {
  it("names an isolated case in Portuguese and links nowhere", () => {
    expect(
      recurrenceView({ clusterId: -1, clusterLabel: "Outliers", isOutlier: true }),
    ).toEqual({
      label: "Caso isolado no mapa",
      href: null,
    });
  });
  it("never says an isolated case does not repeat (E2E rodada 2, P2-1)", () => {
    // It can still be linked to a Problem that gathers other incidents.
    const v = recurrenceView({ clusterId: -1, clusterLabel: null, isOutlier: true });
    expect(v?.label).not.toMatch(/não se repete/);
  });
  it("links a grouped case to its group", () => {
    expect(
      recurrenceView({ clusterId: 3, clusterLabel: "Pix lento", isOutlier: false }),
    ).toEqual({ label: "Pix lento", href: "/recorrencias?grupo=3" });
  });
});

describe("relatedNumbers", () => {
  const summaries = [
    { number: "A", cmdb_ci: "PIX" },
    { number: "B", cmdb_ci: "PIX" },
    { number: "C", cmdb_ci: "Boleto" },
    { number: "D", cmdb_ci: "Cartoes" },
  ];
  const points = [
    { id: "A", cluster_id: -1 },
    { id: "C", cluster_id: -1 },
    { id: "D", cluster_id: 2 },
  ];
  it("never joins isolated cases as one group", () => {
    const r = relatedNumbers(
      { number: "A", service: "PIX", clusterId: -1 },
      summaries,
      points,
    );
    expect(r).toEqual(["B"]);
  });
  it("adds the group mates of a grouped case", () => {
    const r = relatedNumbers(
      { number: "B", service: "PIX", clusterId: 2 },
      summaries,
      points,
    );
    expect(r).toEqual(["A", "D"]);
  });
});

describe("linkedProblem", () => {
  it("finds the Problem that lists this incident", () => {
    const problems = [
      { number: "PRB1", linked_incidents: ["INC1"] },
      { number: "PRB2", linked_incidents: ["INC2", "INC3"] },
    ];
    expect(linkedProblem("INC3", problems)?.number).toBe("PRB2");
    expect(linkedProblem("INC9", problems)).toBeNull();
  });
});
