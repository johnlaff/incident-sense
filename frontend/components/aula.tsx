"use client";

// Modo aula: a switch (topbar, or `?aula=1`) that turns every teaching
// sequence into a step-by-step lesson with a plain caption, advanced by tap,
// arrows, Space or a slide clicker (PageDown / PageUp). It changes no data,
// only the pace and the captions. The API is documented for other screens in
// ui-2026/motion/aula-api.md:
//
//   const { aula } = useAula();
//   const lesson = useAulaLesson({ id, steps, runKey });
//   // render everything with index <= lesson.step
//
// The step machine itself is pure (lib/aula-machine.ts).

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icons } from "./icons";
import {
  AULA_IDLE,
  AULA_STORAGE_KEY as STORAGE_KEY,
  aulaFromQuery,
  aulaKeyAction,
  aulaReducer,
  type KeyTarget,
} from "@/lib/aula-machine";
import { usePrefersReducedMotion } from "@/lib/motion";

/** "Reproduzir tudo" in modo aula: one step every 2,4 s. */
export const AULA_PLAY_MS = 2400;
/** Outside modo aula a replay runs on its own and stays under 2 s in total. */
export const FAST_REPLAY_MS = 240;
/** Autoplay holds "nothing shown" this long, so first entrances can play. */
const PREROLL_MS = 40;
/** Same factor as `--motion-scale` under `data-aula` in globals.css. */
export const AULA_MOTION_SCALE = 1.6;

export interface AulaLessonStep {
  /** Short name of the step, e.g. "Buscar: vetor". */
  title: string;
  /** Plain PT-BR caption, up to ~90 characters, no em dashes. */
  caption: string;
  /** Counter shown before the caption; defaults to "Etapa n de total". */
  counter?: string;
  /**
   * How long this step plays out before the next one, outside modo aula
   * (defaults to the lesson's `fastMs`). In "Reproduzir tudo" it is scaled by
   * the aula motion scale (1,6) and never shorter than 2,4 s.
   */
  durationMs?: number;
}

interface LessonSnapshot {
  id: string;
  order: number;
  /** Bumps each time the lesson starts again; a restarted lesson takes the bar. */
  run: number;
  step: number;
  total: number;
  playing: boolean;
  steps: AulaLessonStep[];
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
}

interface AulaContextValue {
  aula: boolean;
  setAula: (on: boolean) => void;
  toggle: () => void;
  /** The lesson the keys and the caption bar drive (the newest one shown). */
  active: LessonSnapshot | null;
  publish: (snap: Omit<LessonSnapshot, "order">) => void;
  retire: (id: string) => void;
}

const AulaContext = createContext<AulaContextValue | null>(null);

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function keyTarget(el: EventTarget | null): KeyTarget {
  const node = el instanceof Element ? el : null;
  const tag = node?.tagName ?? "";
  const editable =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (node instanceof HTMLElement && node.isContentEditable);
  const pressable = Boolean(node?.closest("button, a[href], [role='button'], summary"));
  const arrowWidget = Boolean(
    node?.closest("[role='tablist'], [role='slider'], [role='menu'], [role='listbox']"),
  );
  // The palette and the peek drawer own the keyboard while open.
  const modal = document.querySelector(".palette, .drawer") !== null;
  return { editable, pressable, arrowWidget, modal };
}

export function AulaProvider({ children }: { children: ReactNode }) {
  const [aula, setAulaState] = useState(false);
  const [lessons, setLessons] = useState<LessonSnapshot[]>([]);
  const order = useRef(0);

  // The boot script already applied ?aula= and the stored choice.
  useEffect(() => {
    const fromQuery = aulaFromQuery(window.location.search);
    setAulaState(fromQuery ?? readStored());
  }, []);

  const setAula = useCallback((on: boolean) => {
    setAulaState(on);
    if (on) document.documentElement.setAttribute("data-aula", "");
    else document.documentElement.removeAttribute("data-aula");
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* private mode: the switch still works for this page */
    }
  }, []);
  const toggle = useCallback(() => setAula(!aula), [aula, setAula]);

  const publish = useCallback((snap: Omit<LessonSnapshot, "order">) => {
    setLessons((list) => {
      const prev = list.find((l) => l.id === snap.id);
      const restarted = !prev || prev.run !== snap.run;
      const entry = { ...snap, order: restarted ? ++order.current : prev.order };
      return prev ? list.map((l) => (l.id === snap.id ? entry : l)) : [...list, entry];
    });
  }, []);
  const retire = useCallback((id: string) => {
    setLessons((list) => list.filter((l) => l.id !== id));
  }, []);

  const active = useMemo(() => {
    const started = lessons.filter((l) => l.step >= 0);
    return started.length ? started.reduce((a, b) => (b.order > a.order ? b : a)) : null;
  }, [lessons]);

  // Slide keys drive the active lesson, only in modo aula.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    if (!aula) return;
    function onKey(e: KeyboardEvent) {
      const lesson = activeRef.current;
      if (!lesson) return;
      const move = aulaKeyAction(
        e.key,
        { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey },
        keyTarget(e.target),
      );
      if (!move) return;
      e.preventDefault();
      if (move === "next") lesson.next();
      else lesson.prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aula]);

  const value = useMemo<AulaContextValue>(
    () => ({ aula, setAula, toggle, active, publish, retire }),
    [aula, setAula, toggle, active, publish, retire],
  );

  return (
    <AulaContext.Provider value={value}>
      {children}
      {aula && active ? <AulaBar lesson={active} /> : null}
    </AulaContext.Provider>
  );
}

/** Modo aula on or off, and the lesson the keys drive right now. */
export function useAula() {
  const ctx = useContext(AulaContext);
  if (!ctx) throw new Error("useAula must be used within <AulaProvider>");
  const { aula, setAula, toggle, active } = ctx;
  return {
    aula,
    setAula,
    toggle,
    /** Index of the active lesson's last revealed step (-1 when none). */
    step: active?.step ?? -1,
    total: active?.total ?? 0,
    next: () => active?.next(),
    prev: () => active?.prev(),
  };
}

export interface AulaLesson {
  aula: boolean;
  /** Last revealed step: -1 before the run, then 0 .. total - 1. */
  step: number;
  total: number;
  playing: boolean;
  /**
   * The run is over: the last step has played out (autoplay), was reached by
   * hand, or "Pular" was pressed. False while the last step is still playing.
   */
  done: boolean;
  next: () => void;
  prev: () => void;
  goTo: (step: number) => void;
  /** Jump to the end ("Pular"). */
  skip: () => void;
  /** Play from here, or start over from the end ("Reproduzir tudo"). */
  play: () => void;
  /** Start this run over from the top, like a new `runKey` ("Repassar"). */
  replay: () => void;
  pause: () => void;
}

/**
 * Register a teaching sequence. Each time `runKey` changes to a non-null
 * value (a new result arrived) the lesson starts again: outside modo aula it
 * replays on its own in under 2 s (instantly with reduced motion); in modo
 * aula it stops at the first step and waits for a tap, arrow, Space or
 * PageDown. `runKey` null clears it (nothing revealed).
 */
export function useAulaLesson({
  id,
  steps,
  runKey,
  fastMs = FAST_REPLAY_MS,
  reducedMotion = "finish",
}: {
  id: string;
  steps: AulaLessonStep[];
  runKey: unknown;
  /** Default step length outside modo aula, when a step has no `durationMs`. */
  fastMs?: number;
  /**
   * With prefers-reduced-motion and outside modo aula: "finish" jumps to the
   * end (default); "pace" keeps the step timing, so the screen can crossfade
   * step by step instead of moving.
   */
  reducedMotion?: "finish" | "pace";
}): AulaLesson {
  const ctx = useContext(AulaContext);
  if (!ctx) throw new Error("useAulaLesson must be used within <AulaProvider>");
  const { aula, publish, retire } = ctx;
  const reduced = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(aulaReducer, AULA_IDLE);
  const total = steps.length;

  // Start (or clear) on a new run, during render, so the first render with a
  // new result never shows the previous run's step. Toggling modo aula
  // mid-run keeps the step.
  const [seen, setSeen] = useState<{ key: unknown } | null>(null);
  const [run, setRun] = useState(0);
  if (seen === null || seen.key !== runKey) {
    setSeen({ key: runKey });
    if (runKey == null) {
      dispatch({ type: "clear" });
    } else {
      setRun((n) => n + 1);
      dispatch({ type: "start", total, playing: !aula });
      if (!aula && reduced && reducedMotion === "finish") dispatch({ type: "finish" });
    }
  }

  // Autoplay: fast outside aula, one step every 2,4 s in "Reproduzir tudo".
  useEffect(() => {
    if (!state.playing) return;
    const own = steps[state.step]?.durationMs;
    // Step -1 is a one-frame pre-roll so the first step's entrance plays.
    const ms =
      state.step < 0
        ? PREROLL_MS
        : aula
          ? Math.max(AULA_PLAY_MS, (own ?? 0) * AULA_MOTION_SCALE)
          : (own ?? fastMs);
    const t = setTimeout(() => dispatch({ type: "next" }), ms);
    return () => clearTimeout(t);
  }, [state.playing, state.step, aula, fastMs, steps]);

  const next = useCallback(() => dispatch({ type: "next" }), []);
  const prev = useCallback(() => dispatch({ type: "prev" }), []);
  const goTo = useCallback((step: number) => dispatch({ type: "goto", step }), []);
  const skip = useCallback(() => dispatch({ type: "finish" }), []);
  const play = useCallback(() => dispatch({ type: "play" }), []);
  // Start the same run over, as a new run would (pre-roll outside aula).
  const replay = useCallback(() => {
    setRun((n) => n + 1);
    dispatch({ type: "start", total, playing: !aula });
  }, [total, aula]);
  const pause = useCallback(() => dispatch({ type: "pause" }), []);
  const playing = state.playing;
  const togglePlay = useCallback(
    () => dispatch({ type: playing ? "pause" : "play" }),
    [playing],
  );

  useEffect(() => {
    publish({
      id,
      run,
      step: state.step,
      total: state.total,
      playing: state.playing,
      steps,
      next,
      prev,
      togglePlay,
    });
  }, [id, run, state, steps, next, prev, togglePlay, publish]);
  useEffect(() => () => retire(id), [id, retire]);

  return {
    aula,
    step: state.step,
    total: state.total,
    playing: state.playing,
    done: state.ended,
    next,
    prev,
    goTo,
    skip,
    play,
    replay,
    pause,
  };
}

/** The fixed caption strip: "Etapa 4 de 7", the caption and the controls. */
function AulaBar({ lesson }: { lesson: LessonSnapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const current = lesson.steps[lesson.step];

  // Publish the bar height so the FAB and the assistant sheet can make room.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    root.setAttribute("data-aula-bar", "");
    const ro = new ResizeObserver(() =>
      root.style.setProperty("--aula-bar-h", `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeAttribute("data-aula-bar");
      root.style.removeProperty("--aula-bar-h");
    };
  }, []);

  if (!current) return null;
  const last = lesson.step >= lesson.total - 1;
  return (
    <div className="aula-bar-wrap">
      <div className="aula-bar" ref={ref} role="region" aria-label="Modo aula">
        <div className="aula-text" aria-live="polite" aria-atomic="true">
          <span className="aula-count">
            {current.counter ?? `Etapa ${lesson.step + 1} de ${lesson.total}`}
          </span>
          <span className="aula-caption">{current.caption}</span>
        </div>
        <div className="aula-ctrl">
          <button
            type="button"
            className="icon-btn aula-btn"
            onClick={lesson.prev}
            disabled={lesson.step <= 0}
            aria-label="Etapa anterior"
            title="Etapa anterior (seta para a esquerda ou PageUp)"
          >
            <Icons.arrowLeft />
          </button>
          <button
            type="button"
            className="icon-btn aula-btn"
            onClick={lesson.togglePlay}
            aria-label={lesson.playing ? "Pausar" : "Reproduzir tudo"}
            title={lesson.playing ? "Pausar" : "Reproduzir tudo"}
          >
            {lesson.playing ? <Icons.pause /> : <Icons.play />}
          </button>
          {last ? (
            // The lesson is over: the next useful step is the next stop.
            <Link href="/aula?aula=1" className="btn btn-primary btn-sm aula-next">
              Voltar ao roteiro
              <Icons.arrowRight />
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm aula-next"
              onClick={lesson.next}
              title="Próxima etapa (seta para a direita, espaço ou PageDown)"
            >
              Próxima etapa
              <Icons.arrowRight />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Topbar switch. The label shows from the labelled rail up. */
export function AulaToggle() {
  const { aula, toggle } = useAula();
  // Off it reads "Modo aula"; on it says so and how to leave, so the mode never
  // stays on unnoticed from one page to the next.
  return (
    <button
      type="button"
      className={`icon-btn aula-toggle${aula ? " on" : ""}`}
      onClick={toggle}
      aria-pressed={aula}
      aria-label={aula ? "Modo aula ligado. Desligar" : "Modo aula"}
      title={
        aula ? "Desligar o modo aula" : "Ligar o modo aula: passo a passo, com legendas"
      }
    >
      <Icons.board />
      {aula ? (
        <span className="aula-toggle-t" aria-hidden="true">
          Modo aula ligado<span className="aula-toggle-off"> · Desligar</span>
        </span>
      ) : (
        <span className="aula-toggle-t" aria-hidden="true">
          Modo aula
        </span>
      )}
    </button>
  );
}
