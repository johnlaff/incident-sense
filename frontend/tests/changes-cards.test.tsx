// The coherence card and the verdict read decision.reason_code (bugs-logica-2
// P1-N1, P1-N2, P1-N3) and the AI's prose renders as text, not markdown (P2-3).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Coherence, Decision, STILL } from "@/app/changes/evaluation";
import { buildSteps } from "@/app/changes/sequence";
import { ProseMarkdown } from "@/components/markdown";
import type { Evaluation, EvaluationDecision, SemanticAnalysis } from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

afterEach(cleanup);

const base = fixture.CHG0031001 as unknown as Evaluation;

function withSemantic(
  decision: EvaluationDecision,
  semantic: Partial<SemanticAnalysis> | null,
): Evaluation {
  return {
    ...base,
    decision,
    semantic: semantic === null ? null : { ...base.semantic!, ...semantic },
  };
}

function card(ev: Evaluation) {
  const steps = buildSteps(ev);
  return render(
    <Coherence result={ev} index={steps.length} steps={steps} skipped motion={STILL} />,
  );
}

describe("Coherence card", () => {
  it("names the back-out plan when that is the failing gate (P1-N1)", () => {
    const ev = withSemantic(
      { passes: false, reason_code: "backout_not_adherent", reason: "x" },
      {
        consistency_score: 8.5,
        backout_adherence: "NAO_ADERENTE",
        backout_adherence_percent: 45,
        problems: [],
      },
    );
    const { container } = card(ev);
    expect(container.textContent).not.toMatch(/coerência ficou abaixo do mínimo/);
    expect(container.textContent).toMatch(/desfaz só 45%/);
  });

  it("says the check did not come back, not that it waits for the average (P1-N2)", () => {
    const ev = withSemantic(
      { passes: false, reason_code: "semantic_missing", reason: "x" },
      null,
    );
    const { container } = card(ev);
    expect(container.textContent).not.toMatch(/só roda quando a média/);
    expect(container.textContent).toMatch(/não respondeu no formato esperado/);
  });

  it("never files a contradiction under 'não impedem' (P1-N3)", () => {
    const ev = withSemantic(
      { passes: false, reason_code: "contradictions", reason: "x" },
      { consistency_score: 9, problems: ["O retorno não reverte a migração"] },
    );
    const { container } = card(ev);
    expect(container.textContent).not.toMatch(/não impedem/);
    expect(screen.getByText("Onde as partes se contradizem")).toBeTruthy();
  });

  it("renders markdown in the reasoning and the guidance (P2-3)", () => {
    const ev = withSemantic(
      { passes: true, reason_code: "passes", reason: "x" },
      {
        problems: [],
        reasoning: "O **plano** cobre tudo.",
        guidance: "- Cite o `indicador`.",
      },
    );
    const { container } = card(ev);
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`");
    expect(container.querySelector("strong")?.textContent).toBe("plano");
  });
});

describe("Decision banner", () => {
  it("shows the backend's own sentence (P2-N3)", () => {
    const reason =
      "A média (8,62) e a coerência (8,5) passaram, mas o plano de retorno desfaz só 20%.";
    const ev = withSemantic(
      { passes: false, reason_code: "backout_not_adherent", reason },
      { backout_adherence: "NAO_ADERENTE", backout_adherence_percent: 20, problems: [] },
    );
    render(<Decision result={ev} />);
    expect(screen.getByText(reason)).toBeTruthy();
  });
});

describe("ProseMarkdown", () => {
  it("drops the markers and keeps the words", () => {
    const { container } = render(<ProseMarkdown source={"**Retorno** e `tabela`"} />);
    expect(container.textContent).toBe("Retorno e tabela");
  });
});
