import { describe, expect, it } from "vitest";

import {
  AULA_IDLE,
  aulaFromQuery,
  aulaKeyAction,
  aulaReducer,
  isLastStep,
  type AulaAction,
  type AulaState,
  type KeyTarget,
} from "@/lib/aula-machine";

function run(state: AulaState, ...actions: AulaAction[]): AulaState {
  return actions.reduce(aulaReducer, state);
}

describe("aulaReducer", () => {
  it("starts on the first step, paused in modo aula", () => {
    expect(run(AULA_IDLE, { type: "start", total: 7, playing: false })).toEqual({
      step: 0,
      total: 7,
      playing: false,
      ended: false,
    });
  });

  it("walks forward and back without leaving the lesson", () => {
    const s = run(AULA_IDLE, { type: "start", total: 3, playing: false });
    expect(run(s, { type: "next" }, { type: "next" }, { type: "next" }).step).toBe(2);
    expect(run(s, { type: "prev" }, { type: "prev" }).step).toBe(0);
    expect(run(s, { type: "goto", step: 9 }).step).toBe(2);
    expect(run(s, { type: "goto", step: -4 }).step).toBe(0);
  });

  it("autoplay pre-rolls one tick before the first step", () => {
    const s = run(AULA_IDLE, { type: "start", total: 3, playing: true });
    expect(s).toEqual({ step: -1, total: 3, playing: true, ended: false });
    expect(run(s, { type: "next" }).step).toBe(0);
  });

  it("autoplay plays the last step out before the run ends", () => {
    let s = run(AULA_IDLE, { type: "start", total: 3, playing: true });
    s = run(s, { type: "next" }, { type: "next" }, { type: "next" });
    // On the last index, still playing: done is not the same as the last index.
    expect(s).toEqual({ step: 2, total: 3, playing: true, ended: false });
    expect(isLastStep(s)).toBe(true);
    s = run(s, { type: "next" });
    expect(s).toEqual({ step: 2, total: 3, playing: false, ended: true });
  });

  it("reaching the last step by hand ends the run at once", () => {
    const s = run(
      AULA_IDLE,
      { type: "start", total: 2, playing: false },
      { type: "next" },
    );
    expect(s.ended).toBe(true);
    expect(run(s, { type: "prev" }).ended).toBe(false);
    expect(run(s, { type: "prev" }, { type: "goto", step: 1 }).ended).toBe(true);
  });

  it("stepping back pauses, and play from the end starts over", () => {
    let s = run(AULA_IDLE, { type: "start", total: 4, playing: true }, { type: "prev" });
    expect(s.playing).toBe(false);
    s = run(s, { type: "finish" });
    expect(s).toEqual({ step: 3, total: 4, playing: false, ended: true });
    s = run(s, { type: "play" });
    expect(s).toEqual({ step: 0, total: 4, playing: true, ended: false });
  });

  it("pausing on the last step ends the run", () => {
    const s = run(
      AULA_IDLE,
      { type: "start", total: 2, playing: true },
      { type: "next" },
      { type: "next" },
      { type: "pause" },
    );
    expect(s).toEqual({ step: 1, total: 2, playing: false, ended: true });
  });

  it("skip reveals everything and clear reveals nothing", () => {
    const s = run(
      AULA_IDLE,
      { type: "start", total: 5, playing: true },
      { type: "finish" },
    );
    expect(s).toEqual({ step: 4, total: 5, playing: false, ended: true });
    expect(run(s, { type: "clear" })).toEqual(AULA_IDLE);
  });

  it("ignores moves while nothing runs; a single step still plays out", () => {
    expect(run(AULA_IDLE, { type: "next" }, { type: "prev" })).toEqual(AULA_IDLE);
    expect(run(AULA_IDLE, { type: "finish" })).toEqual(AULA_IDLE);
    const one = run(
      AULA_IDLE,
      { type: "start", total: 1, playing: true },
      { type: "next" },
    );
    expect(one).toEqual({ step: 0, total: 1, playing: true, ended: false });
    expect(run(one, { type: "next" }).ended).toBe(true);
    expect(run(AULA_IDLE, { type: "start", total: 1, playing: false }).ended).toBe(true);
    expect(run(AULA_IDLE, { type: "start", total: 0, playing: true })).toEqual(AULA_IDLE);
  });
});

describe("aulaKeyAction", () => {
  const none = { alt: false, ctrl: false, meta: false, shift: false };
  const body: KeyTarget = {
    editable: false,
    pressable: false,
    arrowWidget: false,
    modal: false,
  };

  it("maps the slide clicker and the keyboard", () => {
    expect(aulaKeyAction("PageDown", none, body)).toBe("next");
    expect(aulaKeyAction("PageUp", none, body)).toBe("prev");
    expect(aulaKeyAction("ArrowRight", none, body)).toBe("next");
    expect(aulaKeyAction("ArrowLeft", none, body)).toBe("prev");
    expect(aulaKeyAction(" ", none, body)).toBe("next");
    expect(aulaKeyAction(" ", { ...none, shift: true }, body)).toBe("prev");
    expect(aulaKeyAction("j", none, body)).toBeNull();
  });

  it("leaves typing, buttons, tabs and modals alone", () => {
    expect(aulaKeyAction("ArrowRight", none, { ...body, editable: true })).toBeNull();
    expect(aulaKeyAction(" ", none, { ...body, pressable: true })).toBeNull();
    expect(aulaKeyAction("PageDown", none, { ...body, pressable: true })).toBe("next");
    expect(aulaKeyAction("ArrowLeft", none, { ...body, arrowWidget: true })).toBeNull();
    expect(aulaKeyAction("PageDown", none, { ...body, modal: true })).toBeNull();
    expect(aulaKeyAction("ArrowRight", { ...none, meta: true }, body)).toBeNull();
  });
});

describe("aulaKeyAction on the topbar switch (E2E-3 P1-4)", () => {
  const none = { alt: false, ctrl: false, meta: false, shift: false };
  const toggle: KeyTarget = {
    editable: false,
    pressable: true,
    arrowWidget: false,
    modal: false,
    aulaToggle: true,
  };

  it("Space advances instead of switching modo aula off", () => {
    expect(aulaKeyAction(" ", none, toggle)).toBe("next");
    expect(aulaKeyAction(" ", { ...none, shift: true }, toggle)).toBe("prev");
  });

  it("Enter still belongs to the switch", () => {
    expect(aulaKeyAction("Enter", none, toggle)).toBeNull();
  });
});

describe("aulaFromQuery", () => {
  it("reads ?aula=1 and ?aula=0", () => {
    expect(aulaFromQuery("?aula=1")).toBe(true);
    expect(aulaFromQuery("?aula")).toBe(true);
    expect(aulaFromQuery("?aula=0")).toBe(false);
    expect(aulaFromQuery("?x=1")).toBeNull();
  });
});
