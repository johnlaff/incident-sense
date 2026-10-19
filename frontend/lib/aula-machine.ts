// Modo aula: the pure step machine and the keyboard map behind it. No React
// here, so both are unit-tested (tests/aula-machine.test.ts).
//
// A lesson is an ordered list of steps. `step` is the last step revealed:
// -1 before the replay starts, then 0 .. total - 1. Everything up to and
// including `step` is on screen.

export interface AulaState {
  step: number;
  total: number;
  /** Advancing on its own (fast replay, or "Reproduzir tudo" in aula). */
  playing: boolean;
}

export type AulaAction =
  | { type: "start"; total: number; playing: boolean }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; step: number }
  | { type: "finish" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "clear" };

export const AULA_IDLE: AulaState = { step: -1, total: 0, playing: false };

function clamp(step: number, total: number): number {
  return Math.max(total ? 0 : -1, Math.min(step, total - 1));
}

export function aulaReducer(state: AulaState, action: AulaAction): AulaState {
  switch (action.type) {
    case "start": {
      const total = Math.max(0, action.total);
      return { step: total ? 0 : -1, total, playing: action.playing && total > 1 };
    }
    case "next": {
      if (!state.total) return state;
      const step = clamp(state.step + 1, state.total);
      // Reaching the last step ends any autoplay.
      return { ...state, step, playing: state.playing && step < state.total - 1 };
    }
    case "prev":
      if (!state.total) return state;
      return { ...state, step: clamp(state.step - 1, state.total), playing: false };
    case "goto":
      if (!state.total) return state;
      return { ...state, step: clamp(action.step, state.total), playing: false };
    case "finish":
      return { ...state, step: state.total - 1, playing: false };
    case "play":
      if (!state.total || state.step >= state.total - 1) {
        // Replaying from the end starts over, like any media player.
        return state.total ? { ...state, step: 0, playing: state.total > 1 } : state;
      }
      return { ...state, playing: true };
    case "pause":
      return { ...state, playing: false };
    case "clear":
      return AULA_IDLE;
  }
}

export function isLastStep(state: AulaState): boolean {
  return state.total > 0 && state.step >= state.total - 1;
}

/** What the target of a key press is, as far as the slide keys care. */
export interface KeyTarget {
  /** Typing in an input, textarea, select or contenteditable. */
  editable: boolean;
  /** A button, link or role=button: Space and Enter belong to it. */
  pressable: boolean;
  /** Inside a widget that owns the arrow keys (tablist, slider, menu, listbox). */
  arrowWidget: boolean;
  /** A modal (palette, drawer) owns the keyboard. */
  modal: boolean;
}

/**
 * Map a key press to a lesson move. Slide clickers send PageDown / PageUp;
 * the keyboard also gets the arrows and Space. Modifier chords are left
 * alone so browser shortcuts keep working.
 */
export function aulaKeyAction(
  key: string,
  mods: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean },
  target: KeyTarget,
): "next" | "prev" | null {
  if (mods.alt || mods.ctrl || mods.meta) return null;
  if (target.editable || target.modal) return null;
  switch (key) {
    case "PageDown":
      return "next";
    case "PageUp":
      return "prev";
    case " ":
    case "Spacebar":
      if (target.pressable) return null;
      return mods.shift ? "prev" : "next";
    case "ArrowRight":
      return target.arrowWidget ? null : "next";
    case "ArrowLeft":
      return target.arrowWidget ? null : "prev";
    default:
      return null;
  }
}

/** Read `?aula=` from a query string: true, false, or null when absent. */
export function aulaFromQuery(search: string): boolean | null {
  const value = new URLSearchParams(search).get("aula");
  if (value === null) return null;
  return !(value === "0" || value === "false");
}

export const AULA_STORAGE_KEY = "is-aula";

/** Set data-aula before paint (inline in <head>) so the type size never jumps.
 * `?aula=1` turns the mode on and remembers it; `?aula=0` turns it off. */
export const AULA_BOOT_SCRIPT = `(function(){var on=false;try{var q=new URLSearchParams(location.search).get("aula");if(q!==null){on=!(q==="0"||q==="false");try{localStorage.setItem("${AULA_STORAGE_KEY}",on?"1":"0");}catch(e){}}else{on=localStorage.getItem("${AULA_STORAGE_KEY}")==="1";}}catch(e){}if(on){document.documentElement.setAttribute("data-aula","");}})();`;
