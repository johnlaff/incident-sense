// Auditoria de lógica, rodada 3 (bugs-logica-3.md): the header badge fits a
// phone, the assistant button never sits under the aula bar, and every view
// of a decision says each gate that failed, and why, the way the backend does.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Average, Coherence, Decision, STILL } from "@/app/changes/evaluation";
import {
  buildSteps,
  coherenceNote,
  decisionOf,
  nextDirty,
  rerunHint,
  sentFields,
  verdictOf,
  weightedSegments,
} from "@/app/changes/sequence";
import {
  markText,
  stateHint,
  type Evaluation,
  type EvaluationDecision,
  type FieldKey,
  type FieldScore,
  type SemanticAnalysis,
} from "@/lib/changes";

afterEach(cleanup);

const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const CHANGES_CSS = readFileSync(
  join(__dirname, "..", "app", "changes", "changes.css"),
  "utf8",
);

/** The declarations of every rule whose selector is exactly `selector`. */
function rules(selector: string, css = CSS): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sels = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

/** The bodies of every @media block with this exact condition, joined. */
function media(condition: string): string {
  const bodies: string[] = [];
  let at = CSS.indexOf(`@media ${condition} {`);
  while (at !== -1) {
    const open = CSS.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      if (CSS[i] === "}" && --depth === 0) {
        bodies.push(CSS.slice(open + 1, i));
        break;
      }
    }
    at = CSS.indexOf(`@media ${condition} {`, open);
  }
  return bodies.join("\n");
}

const WEIGHTS: [FieldKey, string, number][] = [
  ["implementation_plan", "Plano de implementação", 2.5],
  ["validation_plan", "Plano de validação", 2.5],
  ["objective", "Objetivo", 2],
  ["benefits", "Benefícios", 2],
  ["test_justification", "Justificativa dos testes", 2],
  ["short_description", "Descrição resumida", 1.5],
  ["prerequisites", "Pré-requisitos", 1],
];

function fields(
  score = 9.2,
  over: Partial<Record<FieldKey, Partial<FieldScore>>> = {},
): FieldScore[] {
  return WEIGHTS.map(([key, label, weight]) => ({
    key,
    label,
    weight,
    score,
    diagnosis: "d",
    guidance: "",
    reused: false,
    content_hash: key,
    ...over[key],
  }));
}

const NO_OBJECTIVE = { objective: { score: null, failed: true } };

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

function ev(decision: EvaluationDecision | undefined, over: Partial<Evaluation> = {}) {
  const e: Evaluation = {
    number: "CHG0031001",
    rubric_version: "v",
    scope: { in_scope: true, reason: "" },
    fields: fields(),
    overall: 9.2,
    threshold: 8,
    semantic: sem(),
    semantic_skipped_reason: null,
    model: "m",
    model_calls: 8,
    duration_ms: 1000,
    ...over,
  };
  if (decision) e.decision = decision;
  return e;
}

function average(e: Evaluation) {
  const steps = buildSteps(e);
  return render(
    <Average
      result={e}
      avg={weightedSegments(e.fields)}
      previousAvg={null}
      previousOverall={null}
      index={steps.length}
      steps={steps}
      skipped
      motion={STILL}
    />,
  );
}

function card(e: Evaluation) {
  const steps = buildSteps(e);
  return render(
    <Coherence result={e} index={steps.length} steps={steps} skipped motion={STILL} />,
  );
}

const gate2 = (container: HTMLElement) =>
  container.querySelectorAll<HTMLElement>(".chg-q")[1];

describe("P0-A: the header badge fits a 360 px phone", () => {
  it("says the verdict in a few words, for every verdict", () => {
    for (const verdict of ["Pode seguir", "Não segue", "Não segue ainda"]) {
      const shown = `Nova: ${stateHint("New", verdict)}`;
      // 42 characters of 12 px Inter fit the 328 px a 360 px phone leaves.
      expect(shown.length, shown).toBeLessThanOrEqual(42);
      expect(shown).toMatch(new RegExp(verdict, "i"));
    }
  });

  it("lets the badge wrap inside the page", () => {
    const own = rules(".chg-record-head .chg-state", CHANGES_CSS).join(";");
    expect(own).toMatch(/white-space:\s*normal/);
    expect(own).toMatch(/max-width:\s*100%/);
    expect(own).toMatch(/height:\s*auto/);
  });
});

describe("P1-A and P2-1: the assistant button never meets the aula bar", () => {
  it("is hidden while the aula bar is shown, at every width", () => {
    const own = rules(":root[data-aula-bar] .cop-fab").join(";");
    expect(own).toMatch(/display:\s*none/);
    // No wider rule brings it back next to the bar.
    expect(media("(min-width: 768px)")).not.toMatch(/data-aula-bar\]\s*\.cop-fab/);
  });

  it("lets the bar use the corner the button no longer takes", () => {
    const wide = rules(".aula-bar-wrap", media("(min-width: 768px)")).join(";");
    expect(wide).not.toMatch(/right:\s*100px/);
  });
});

describe("P2-2: a missing field draws nothing as passed or failed", () => {
  const e = ev(
    {
      passes: false,
      reason_code: "field_missing",
      reason: "x",
      failed: ["field_missing"],
    },
    { fields: fields(9.2, NO_OBJECTIVE), semantic: null },
  );

  it("keeps the average neutral and the gate undrawn", async () => {
    const { container } = average(e);
    const chip = container.querySelector(".chg-avg-head > :first-child")!;
    await waitFor(() => expect(chip.className).toMatch(/neutral/));
    expect(container.querySelector(".chg-scale")!.getAttribute("data-gate")).toBe(
      "neutral",
    );
  });

  it("leaves the score out of the list badge", () => {
    expect(
      markText({
        overall: 9.2,
        passed: false,
        ok: false,
        title: "Não segue ainda",
        partial: true,
      }),
    ).toBe("Não segue ainda");
    expect(
      markText({ overall: 8.62, passed: true, ok: true, title: "Pode seguir" }),
    ).toBe("Pode seguir · 8,62");
  });
});

describe("P2-3: the coherence colour follows the gate, not the number", () => {
  it("shows the contradiction, not a red 9,0, when that is what failed", async () => {
    const e = ev(
      {
        passes: false,
        reason_code: "contradictions",
        reason: "x",
        failed: ["contradictions"],
      },
      { semantic: sem({ problems: ["O retorno não reverte a migração"] }) },
    );
    const { container } = render(<Decision result={e} />);
    const row = gate2(container);
    expect(row.querySelector(".chg-q-answer b")!.textContent).toBe("1 contradição");
    expect(row.textContent).not.toMatch(/9,0/);
    cleanup();
    const chip = card(e).container.querySelector(".chg-sem-tile > :first-child")!;
    await waitFor(() => expect(chip.className).toMatch(/neutral/));
  });

  it("shows the back-out percent when the back-out plan is what failed", () => {
    const e = ev(
      {
        passes: false,
        reason_code: "backout_not_adherent",
        reason: "x",
        failed: ["backout_not_adherent"],
      },
      {
        semantic: sem({
          backout_adherence: "NAO_ADERENTE",
          backout_adherence_percent: 45,
        }),
      },
    );
    const row = gate2(render(<Decision result={e} />).container);
    expect(row.querySelector(".chg-q-answer b")!.textContent).toBe("45%");
  });

  it("still shows the coherence number when coherence is what failed", () => {
    const e = ev(
      {
        passes: false,
        reason_code: "coherence_below",
        reason: "x",
        failed: ["coherence_below"],
      },
      { semantic: sem({ consistency_score: 4 }) },
    );
    const row = gate2(render(<Decision result={e} />).container);
    expect(row.querySelector(".chg-q-answer b")!.textContent).toBe("4,0");
  });
});

describe("P2-4: every failing gate is named", () => {
  const s = sem({
    problems: ["O retorno não reverte a migração"],
    backout_adherence: "NAO_ADERENTE",
    backout_adherence_percent: 30,
  });

  it("question 2 cites the contradiction and the 30% together", () => {
    const e = ev(
      {
        passes: false,
        reason_code: "contradictions",
        reason: "x",
        failed: ["contradictions", "backout_not_adherent"],
      },
      { semantic: s },
    );
    const note = gate2(render(<Decision result={e} />).container).querySelector(
      ".chg-q-note",
    )!;
    expect(note.textContent).toMatch(/contradição/);
    expect(note.textContent).toMatch(/30%/);
  });

  it("an old payload without a decision says both too", () => {
    const e = ev(undefined, { semantic: s });
    expect(decisionOf(e)!.failed).toEqual(["contradictions", "backout_not_adherent"]);
    const reason = verdictOf(e)!.reason;
    expect(reason).toMatch(/contradição/);
    expect(reason).toMatch(/30%/);
  });
});

describe("P2-5: a coherence check that did not come back says why", () => {
  const missing = (why: string) =>
    ev(
      {
        passes: false,
        reason_code: "semantic_missing",
        reason: "x",
        failed: ["semantic_missing"],
      },
      { semantic: null, semantic_skipped_reason: `Não conferida: ${why}` },
    );

  it("a timeout is a timeout", () => {
    const e = missing("a IA demorou demais para responder. Avalie de novo.");
    expect(coherenceNote(e)!.line).toMatch(/demorou demais/);
    expect(coherenceNote(e)!.line).not.toMatch(/formato/);
    expect(buildSteps(e).at(-1)!.caption).toMatch(/demorou demais/);
  });

  it("no quota says so, and to try later", () => {
    const e = missing("a IA está sem cota agora. Tente de novo mais tarde.");
    expect(coherenceNote(e)!.line).toMatch(/sem cota/);
    expect(buildSteps(e).at(-1)!.caption).toMatch(/mais tarde/);
    const note = gate2(render(<Decision result={e} />).container).querySelector(
      ".chg-q-note",
    )!;
    expect(note.textContent).toMatch(/sem cota/);
  });

  it("an odd reply keeps the format sentence", () => {
    const e = missing("a IA não respondeu no formato esperado. Avalie de novo.");
    expect(coherenceNote(e)!.line).toMatch(/formato esperado/);
  });
});

describe("P2-6: re-evaluating after a missing field says what went back", () => {
  it("the field the AI had not graded goes back, even with no edit", () => {
    expect(
      sentFields({ dirty: 0, failed: 1, modelChanged: false, total: 7, first: false }),
    ).toBe(1);
    expect(rerunHint({ dirty: 0, failed: 1, modelChanged: false, total: 7 })).toMatch(
      /não tinha avaliado/,
    );
  });

  it("the first step names it instead of 'texto novo'", () => {
    const before = ev(
      {
        passes: false,
        reason_code: "field_missing",
        reason: "x",
        failed: ["field_missing"],
      },
      { fields: fields(9.2, NO_OBJECTIVE), semantic: null },
    );
    const reused = Object.fromEntries(
      WEIGHTS.filter(([k]) => k !== "objective").map(([k]) => [k, { reused: true }]),
    );
    const after = ev(
      { passes: true, reason_code: "passes", reason: "x", failed: [] },
      { fields: fields(9.2, reused) },
    );
    const caption = buildSteps(after, before)[0].caption;
    expect(caption).toMatch(/não tinha avaliado voltou/);
    expect(caption).not.toMatch(/texto novo/);
  });
});

describe("P2-7: 'ainda' only when a new reading could still pass", () => {
  const low = fields(6, NO_OBJECTIVE);

  it("an old payload with no way to reach the cut is a plain 'Não segue'", () => {
    const e = ev(undefined, { fields: low, semantic: null });
    expect(decisionOf(e)!.code).toBe("average_below");
    const v = verdictOf(e)!;
    expect(v.title).toBe("Não segue");
    expect(v.reason).toMatch(/no máximo/);
  });

  it("the gate step does not ask to evaluate again", () => {
    const e = ev(
      {
        passes: false,
        reason_code: "average_below",
        reason: "Mesmo com nota 10 em Objetivo, a média chegaria no máximo a 6,59.",
        failed: ["average_below"],
      },
      { fields: low, semantic: null },
    );
    const portao = buildSteps(e).find((s) => s.id === "portao")!;
    expect(portao.caption).not.toMatch(/sem resposta|avalie de novo/i);
    expect(portao.caption).toMatch(/nota 10/);
    const { container } = average(e);
    expect(container.textContent).not.toMatch(/não decide/);
  });
});

describe("P2-8: editing a field back to the text that was read is no edit", () => {
  it("drops the field from the edited set", () => {
    const dirty = nextDirty(new Set<FieldKey>(), "objective", "novo", "original");
    expect([...dirty]).toEqual(["objective"]);
    expect([...nextDirty(dirty, "objective", "original", "original")]).toEqual([]);
  });
});
