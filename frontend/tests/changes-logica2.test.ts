// Auditoria de lógica, rodada 2 (bugs-logica-2.md) e E2E rodada 2 (bugs-e2e-2.md):
// the screen reads one decision, the backend's, and says which gate failed.
import { describe, expect, it } from "vitest";

import {
  buildSteps,
  coherenceNote,
  decisionOf,
  overallOf,
  runningLine,
  verdictOf,
  weightedSegments,
} from "@/app/changes/sequence";
import {
  isEvaluation,
  markLabel,
  stateHint,
  type Evaluation,
  type EvaluationDecision,
  type FieldKey,
  type FieldScore,
  type SemanticAnalysis,
} from "@/lib/changes";

const WEIGHTS: [FieldKey, string, number][] = [
  ["implementation_plan", "Plano de implementação", 2.5],
  ["validation_plan", "Plano de validação", 2.5],
  ["objective", "Objetivo", 2],
  ["benefits", "Benefícios", 2],
  ["test_justification", "Justificativa dos testes", 2],
  ["short_description", "Descrição resumida", 1.5],
  ["prerequisites", "Pré-requisitos", 1],
];

function fields(score: number | null = 9.2, reused = false): FieldScore[] {
  return WEIGHTS.map(([key, label, weight]) => ({
    key,
    label,
    weight,
    score,
    diagnosis: "d",
    guidance: "",
    reused,
    content_hash: key,
  }));
}

function sem(over: Partial<SemanticAnalysis> = {}): SemanticAnalysis {
  return {
    consistency_score: 9,
    problems: [],
    reasoning: "r",
    guidance: "",
    backout_adherence: "ADERENTE",
    backout_adherence_percent: 90,
    reused: false,
    ...over,
  };
}

function ev(decision: EvaluationDecision, over: Partial<Evaluation> = {}): Evaluation {
  return {
    number: "CHG0031001",
    rubric_version: "v",
    scope: { in_scope: true, reason: "" },
    fields: fields(),
    overall: 9.2,
    threshold: 8,
    semantic: sem(),
    semantic_skipped_reason: null,
    decision,
    model: "m",
    model_calls: 8,
    duration_ms: 1000,
    ...over,
  };
}

const last = (e: Evaluation) => buildSteps(e).at(-1)!;

describe("P1-N3: a real contradiction holds the change back", () => {
  const e = ev(
    {
      passes: false,
      reason_code: "contradictions",
      reason:
        "A média (9,20) e a coerência (9,0) passaram, mas a IA encontrou 1 contradição entre as partes do pedido.",
    },
    { semantic: sem({ problems: ["O retorno não reverte a migração de dados"] }) },
  );

  it("fails gate 2 and shows the backend's sentence", () => {
    expect(decisionOf(e)!.coherence.state).toBe("fail");
    const v = verdictOf(e)!;
    expect(v.ok).toBe(false);
    expect(v.title).toBe("Não segue");
    expect(v.reason).toBe(e.decision!.reason);
  });

  it("never calls the points suggestions or says they do not hold back", () => {
    const step = last(e);
    expect(step.caption).not.toMatch(/sugest|não impedem/i);
    expect(step.caption).toMatch(/contradição/);
    const note = coherenceNote(e)!;
    expect(note.title).not.toMatch(/não impedem/);
  });
});

describe("P1-N1: the failing gate is named from decision.reason_code", () => {
  const e = ev(
    {
      passes: false,
      reason_code: "backout_not_adherent",
      reason:
        "A média (9,20) e a coerência (8,5) passaram, mas o plano de retorno desfaz só 45%.",
    },
    {
      semantic: sem({
        consistency_score: 8.5,
        backout_adherence: "NAO_ADERENTE",
        backout_adherence_percent: 45,
      }),
    },
  );

  it("speaks of the back-out plan, not of a coherence under the cut", () => {
    for (const text of [last(e).caption, coherenceNote(e)!.line]) {
      expect(text).not.toMatch(/coerência ficou abaixo/);
      expect(text).toMatch(/plano de retorno/);
      expect(text).toMatch(/45%/);
      expect(text).toMatch(/50%/);
    }
  });
});

describe("P1-N2: coherence that did not come back", () => {
  const e = ev(
    {
      passes: false,
      reason_code: "semantic_missing",
      reason:
        "A média passou do mínimo (9,20), mas a conferência das partes do pedido não voltou. Avalie de novo.",
    },
    {
      semantic: null,
      semantic_skipped_reason:
        "A IA não respondeu à conferência de coerência no formato esperado. Avalie de novo.",
    },
  );

  it("says why, never that it only runs past the average", () => {
    const note = coherenceNote(e)!;
    expect(note.line).toMatch(/não respondeu no formato esperado/);
    expect(note.line).not.toMatch(/só roda/);
  });

  it("ends the lesson on a verdict step", () => {
    const steps = buildSteps(e);
    expect(steps.map((s) => s.id)).toEqual(["notas", "media", "portao", "coerencia"]);
    expect(last(e).caption).toMatch(/Não segue ainda/);
    expect(verdictOf(e)!.title).toBe("Não segue ainda");
  });

  it("an average under the cut keeps its own sentence", () => {
    const low = ev(
      { passes: false, reason_code: "average_below", reason: "A média ficou em 3,00." },
      { semantic: null, fields: fields(3), overall: 3 },
    );
    expect(coherenceNote(low)!.line).toMatch(/só é conferida quando a média/);
  });
});

describe("P1-N4: reuse is said honestly", () => {
  const reusedAll = ev(
    { passes: true, reason_code: "passes", reason: "ok" },
    { fields: fields(9.2, true), model_calls: 0, semantic: sem({ reused: true }) },
  );

  it("a first result in this tab that was all reused does not claim a fresh reading", () => {
    const caption = buildSteps(reusedAll, null)[0].caption;
    expect(caption).not.toMatch(/Uma IA juíza dá nota/);
    expect(caption).toMatch(/reaproveitadas, sem chamar a IA/);
  });

  it("re-evaluating with nothing edited says nothing changed (P2-N4)", () => {
    const caption = buildSteps(reusedAll, reusedAll)[0].caption;
    expect(caption).toMatch(/Nada mudou/);
    expect(caption).not.toMatch(/Só os campos editados/);
  });

  it("the running line does not promise a fresh reading the server may skip", () => {
    expect(runningLine(7, { mayReuse: true })).not.toMatch(/lendo os 7 campos/);
    expect(runningLine(7, { mayReuse: false })).toMatch(/lendo os 7 campos/);
  });
});

describe("P1-R1: one field the AI could not read", () => {
  const fs = fields();
  fs[2] = {
    ...fs[2],
    score: null,
    failed: true,
    diagnosis: "A IA não conseguiu avaliar este campo. Avalie de novo.",
  };
  const e = ev(
    {
      passes: false,
      reason_code: "field_missing",
      reason:
        "A IA não conseguiu avaliar o campo Objetivo. Sem essa nota não há veredito: avalie de novo.",
    },
    { fields: fs, semantic: null, overall: 9.2 },
  );

  it("is a valid response", () => {
    expect(isEvaluation(e)).toBe(true);
  });

  it("the average leaves the missing field out, like the backend", () => {
    expect(overallOf(e)).toBe(9.2);
    expect(weightedSegments(e.fields).segments).toHaveLength(6);
  });

  it("holds the verdict back and names the field", () => {
    const d = decisionOf(e)!;
    expect(d.ok).toBe(false);
    expect(d.code).toBe("field_missing");
    expect(verdictOf(e)!.title).toBe("Não segue ainda");
    const steps = buildSteps(e);
    expect(steps.at(-1)!.caption).toMatch(/Objetivo/);
  });
});

describe("P2-N3: one back-out sentence everywhere", () => {
  it("the banner reads the backend's reason", () => {
    const reason =
      "A média (9,20) e a coerência (9,0) passaram, mas o plano de retorno desfaz só 20%.";
    const e = ev(
      { passes: false, reason_code: "backout_not_adherent", reason },
      {
        semantic: sem({
          backout_adherence: "NAO_ADERENTE",
          backout_adherence_percent: 20,
        }),
      },
    );
    expect(verdictOf(e)!.reason).toBe(reason);
  });
});

describe("E2E P2-6: the coherence caption fits the aula bar", () => {
  it("stays short", () => {
    const e = ev({ passes: true, reason_code: "passes", reason: "ok" });
    const step = buildSteps(e).find((s) => s.id === "coerencia")!;
    expect(step.caption.length).toBeLessThanOrEqual(130);
  });
});

describe("E2E P0-2: the header state never fights the verdict", () => {
  it("does not say 'não analisada' once the AI answered", () => {
    expect(stateHint("New", "Pode seguir")).not.toMatch(/não analisada|não avaliada/);
    expect(stateHint("New", "Pode seguir")).toMatch(
      /a IA diz pode seguir, falta aprovar/,
    );
    expect(stateHint("New", null)).not.toMatch(/não analisada/);
  });
});

describe("P2-N2: the list mark says 'Não segue ainda'", () => {
  it("keeps the verdict title of the detail", () => {
    expect(
      markLabel({ overall: 9.2, passed: true, ok: false, title: "Não segue ainda" }),
    ).toBe("Não segue ainda");
    expect(markLabel({ overall: 9.2, passed: true, ok: true })).toBe("Pode seguir");
    expect(markLabel({ overall: 3, passed: false })).toBe("Não segue");
  });
});
