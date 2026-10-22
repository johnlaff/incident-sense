// Auditorias da rodada 5 (bugs-logica-5.md e bugs-e2e-5.md): a question never
// stays on a 409 after the server lost the analysis, a new analysis starts a new
// conversation, the record shows one AI note everywhere, the Change card puts
// suggestions under "Pontos de atenção", and the chat is reachable in modo aula.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Coherence, STILL } from "@/app/changes/evaluation";
import { buildSteps, editTag, gradedTexts, rerunHint } from "@/app/changes/sequence";
import { StepDetail } from "@/components/pipeline-trace";
import { ApiError } from "@/lib/api";
import type { Change, Evaluation, FieldKey, FieldScore } from "@/lib/changes";
import {
  afterAskError,
  followUpBody,
  readChat,
  restartTurns,
  saveChat,
  type Turn,
} from "@/lib/followup";
import { activityWithNotes, type ActivityItem } from "@/lib/model";
import { mergeNotes } from "@/lib/pipeline";
import type { WorkNote } from "@/lib/types";

import fixture from "./evaluation-fixture.json";
import { suggestFixture } from "./suggest-fixture";

afterEach(cleanup);

const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The body of the first `@media` block that opens exactly with `query`. */
function media(query: string): string {
  const at = CSS.indexOf(`@media ${query} {`);
  expect(at).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}\n", at));
}

const turn = (over: Partial<Turn> = {}): Turn => ({
  id: 1,
  question: "Qual é o primeiro passo?",
  state: "running",
  res: null,
  error: null,
  ...over,
});

const lost = () => new ApiError(409, "Ainda não há análise.");

describe("logica-5 P1-1: a 409 after a restart re-syncs once, then says what to do", () => {
  it("the first 409 of a question runs the analysis again and asks after it", () => {
    const next = afterAskError(turn(), lost(), true);
    expect(next.reanalyze).toBe(true);
    expect(next.turn.state).toBe("waiting");
    expect(next.turn.resynced).toBe(true);
  });

  it("a second 409 for the same question stops, in PT-BR, with 'Analisar de novo'", () => {
    const next = afterAskError(turn({ resynced: true }), lost(), true);
    expect(next.reanalyze).toBe(false);
    expect(next.turn.state).toBe("error");
    expect(next.turn.needsAnalysis).toBe(true);
    expect(next.turn.error).toMatch(/análise/);
    expect(next.turn.error).not.toMatch(/409|conflict/i);
  });

  it("does not depend on where the analysis came from: a restored chat re-syncs too", () => {
    window.sessionStorage.clear();
    saveChat("INC0052233", {
      response: suggestFixture({ analysis_id: "a1" }),
      durationMs: 1000,
      model: "m",
      turns: [turn({ state: "done", res: null })],
    });
    const back = readChat("INC0052233")!;
    expect(back.response.analysis_id).toBe("a1");
    const asked = turn({ id: 2, question: "E depois?" });
    expect(afterAskError(asked, lost(), true).reanalyze).toBe(true);
  });

  it("any other error keeps its own message and retry", () => {
    const next = afterAskError(
      turn(),
      new ApiError(503, "A IA está indisponível."),
      true,
    );
    expect(next.reanalyze).toBe(false);
    expect(next.turn).toMatchObject({ state: "error", error: "A IA está indisponível." });
    expect(next.turn.needsAnalysis).toBeFalsy();
    expect(afterAskError(turn(), new Error("x"), true).turn.error).toBe(
      "Não foi possível responder agora.",
    );
  });

  it("after a restart the new note replaces the old one in place (same author)", () => {
    const note = (id: string, text: string): WorkNote =>
      ({
        id,
        author: "Assistente da IA",
        text,
        created_at: "2026-10-21T10:00:00Z",
      }) as WorkNote;
    const merged = mergeNotes(
      [note("antes-do-reinicio", "antes")],
      note("novo", "depois"),
    );
    expect(merged.map((n) => n.text)).toEqual(["depois"]);
  });
});

describe("logica-5 P2-2: the question says which analysis it is about", () => {
  it("sends the analysis id the page shows", () => {
    const body = followUpBody(suggestFixture({ analysis_id: "abc" }), "Por quê?");
    expect(body.analysis_id).toBe("abc");
    expect("analysis_id" in followUpBody(suggestFixture(), "Por quê?")).toBe(false);
  });
});

describe("e2e-5 P1-2: a new analysis starts a new conversation", () => {
  it("drops the answered questions and keeps the ones waiting for it", () => {
    const turns = [
      turn({ id: 1, state: "done" }),
      turn({ id: 2, state: "error" }),
      turn({ id: 3, state: "waiting" }),
    ];
    const next = restartTurns(turns);
    expect(next.turns.map((t) => t.id)).toEqual([3]);
    expect(next.restarted).toBe(true);
    expect(restartTurns([]).restarted).toBe(false);
  });
});

describe("logica-5 P2-1: Atividade and Notas de trabalho read the same AI note", () => {
  const base: ActivityItem[] = [
    { kind: "open", who: { name: "M", initials: "M" }, when: "1", text: "aberto" },
    { kind: "resolve", who: { name: "A", initials: "A" }, when: "2", text: "resolvido" },
  ];
  const note = { id: "n1", author: "Assistente da IA", text: "nova", created_at: "" };

  it("the note goes before the resolution, with the text the notes show", () => {
    const items = activityWithNotes(base, [note as WorkNote]);
    expect(items.map((i) => i.kind)).toEqual(["open", "note", "resolve"]);
    expect(items[1].text).toMatch(/nova/);
  });

  it("mapDetail leaves the published notes to that one source", () => {
    const src = readFileSync(join(__dirname, "..", "lib", "model.ts"), "utf8");
    const synth = src.slice(src.indexOf("function synthActivity"));
    expect(synth.slice(0, synth.indexOf("\n}\n"))).not.toMatch(/published_notes/);
  });
});

/* ---------------------------------------------------------------- Changes */

const CHANGE = { number: "CHG0031001" } as unknown as Change;

describe("logica-5 P2-3 and e2e-5 P2-2: a text already read keeps the grade only if it has one", () => {
  const field = (key: FieldKey, score: number | null) =>
    ({ key, score, label: key }) as unknown as FieldScore;

  it("only graded texts count as already read", () => {
    const read = gradedTexts(
      {},
      { objective: "a", benefits: "b" },
      { ...CHANGE, objective: "a", benefits: "b" } as Change,
      [field("objective", 9), field("benefits", null)],
    );
    expect(read.objective).toEqual(["a"]);
    expect(read.benefits).toBeUndefined();
  });

  it("the hint does not promise a grade the server may have lost", () => {
    const hint = rerunHint({ dirty: 0, recalled: 1, modelChanged: false, total: 7 })!;
    expect(hint).not.toMatch(/sem chamar a IA/);
    expect(hint).toMatch(/se ela ainda estiver guardada/);
  });

  it("the field tag agrees with the hint", () => {
    expect(editTag(true)).not.toMatch(/será reavaliado/);
    expect(editTag(true)).toMatch(/já avaliado/);
    expect(editTag(false)).toBe("Editado: será reavaliado");
  });
});

describe("e2e-5 P0-1: suggestions and gaps are 'Pontos de atenção', never contradictions", () => {
  const ev = (attention?: string[]): Evaluation => {
    const base = structuredClone(fixture.CHG0031001) as unknown as Evaluation;
    if (attention) base.semantic = { ...base.semantic!, attention };
    else delete (base.semantic as { attention?: string[] }).attention;
    return base;
  };
  const card = (e: Evaluation) => {
    const steps = buildSteps(e);
    return render(
      <Coherence result={e} index={steps.length} steps={steps} skipped motion={STILL} />,
    ).container;
  };

  it("lists them under their own heading, outside the contradictions", () => {
    const box = card(ev(["Registrar o snapshot de backup antes do retorno."]));
    const heads = [...box.querySelectorAll("h3")].map((h) => h.textContent);
    expect(heads).toContain("Pontos de atenção");
    expect(box.querySelector(".chg-attention")?.textContent).toMatch(/snapshot/);
    expect(box.querySelector(".chg-problems")).toBeNull();
  });

  it("shows nothing when there are none, or the server is older", () => {
    for (const e of [ev([]), ev()]) {
      const box = card(e);
      expect(box.textContent).not.toMatch(/Pontos de atenção/);
    }
  });
});

/* ------------------------------------------------- the chat in modo aula */

describe("e2e-5 P1-1: the chat is reachable with modo aula on", () => {
  it("step 7 offers 'Fazer uma pergunta' when it can open the chat", () => {
    let asked = 0;
    const { getByRole } = render(
      <StepDetail
        step="publicar"
        result={suggestFixture()}
        source={{ category: "", subcategory: "", empresa: "", description: "", tags: [] }}
        beat={8}
        modelName="m"
        onCite={() => {}}
        flashCite={null}
        onShowNotes={() => {}}
        onAsk={() => asked++}
      />,
    );
    getByRole("button", { name: "Fazer uma pergunta" }).click();
    expect(asked).toBe(1);
  });

  it("the rail keeps the assistant button during the lesson (phones use step 7)", () => {
    const hide = CSS.slice(
      CSS.lastIndexOf("@media", CSS.indexOf(":root[data-aula-bar] .cop-fab {")),
      CSS.indexOf(":root[data-aula-bar] .cop-fab {"),
    );
    // The rule that hides it lives in the phone-only block.
    expect(hide).toMatch(/^@media \(max-width: 767px\) \{\s*$/);
  });
});

describe("logica-5 P2-5: at 768 to 920 px the button sits in the narrow rail", () => {
  it("is a 44 px circle at the rail's left, its label kept for screen readers", () => {
    const block = media("(min-width: 768px) and (max-width: 920px)");
    const fab = block.slice(block.indexOf(".cop-fab {"));
    expect(fab.slice(0, fab.indexOf("}"))).toMatch(/left:\s*8px/);
    expect(fab.slice(0, fab.indexOf("}"))).toMatch(/width:\s*44px/);
    const label = block.slice(block.indexOf(".cop-fab-t {"));
    expect(label.slice(0, label.indexOf("}"))).toMatch(/clip/);
  });
});
