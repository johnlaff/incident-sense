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
    });
  });

  it("walks forward and back without leaving the lesson", () => {
    const s = run(AULA_IDLE, { type: "start", total: 3, playing: false });
    expect(run(s, { type: "next" }, { type: "next" }, { type: "next" }).step).toBe(2);
    expect(run(s, { type: "prev" }, { type: "prev" }).step).toBe(0);
    expect(run(s, { type: "goto", step: 9 }).step).toBe(2);
    expect(run(s, { type: "goto", step: -4 }).step).toBe(0);
  });

  it("stops autoplay on the last step", () => {
    let s = run(AULA_IDLE, { type: "start", total: 3, playing: true });
    expect(s.playing).toBe(true);
    s = run(s, { type: "next" });
    expect(s.playing).toBe(true);
    s = run(s, { type: "next" });
    expect(s).toEqual({ step: 2, total: 3, playing: false });
    expect(isLastStep(s)).toBe(true);
  });

  it("stepping back pauses, and play from the end starts over", () => {
    let s = run(AULA_IDLE, { type: "start", total: 4, playing: true }, { type: "prev" });
    expect(s.playing).toBe(false);
    s = run(s, { type: "finish" });
    expect(s.step).toBe(3);
    s = run(s, { type: "play" });
    expect(s).toEqual({ step: 0, total: 4, playing: true });
  });

  it("skip reveals everything and clear reveals nothing", () => {
    const s = run(
      AULA_IDLE,
      { type: "start", total: 5, playing: true },
      { type: "finish" },
    );
    expect(s).toEqual({ step: 4, total: 5, playing: false });
    expect(run(s, { type: "clear" })).toEqual(AULA_IDLE);
  });

  it("ignores moves while nothing runs and never autoplays a single step", () => {
    expect(run(AULA_IDLE, { type: "next" }, { type: "prev" })).toEqual(AULA_IDLE);
    expect(run(AULA_IDLE, { type: "start", total: 1, playing: true }).playing).toBe(
      false,
    );
    expect(run(AULA_IDLE, { type: "start", total: 0, playing: true }).step).toBe(-1);
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

describe("aulaFromQuery", () => {
  it("reads ?aula=1 and ?aula=0", () => {
    expect(aulaFromQuery("?aula=1")).toBe(true);
    expect(aulaFromQuery("?aula")).toBe(true);
    expect(aulaFromQuery("?aula=0")).toBe(false);
    expect(aulaFromQuery("?x=1")).toBeNull();
  });
});
