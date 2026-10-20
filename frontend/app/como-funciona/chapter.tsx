"use client";

// One chapter of the walkthrough: a big headline, why it matters, the steps
// (each with its own explanatory visual), a link to the real screen and the
// technical details behind a disclosure.
//
// Three ways to read it, one markup:
//  - Normal scroll: everything is on screen in its final state. Where the
//    browser supports scroll-driven animation (and motion is allowed), each
//    visual plays as it scrolls into view; otherwise it simply sits there.
//  - "Reproduzir": the steps play in order, fast, without moving the page.
//  - Modo aula: the chapter starts when it reaches the middle of the screen
//    and goes one step per tap, arrow, Space or PageDown, with captions.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAula, useAulaLesson } from "@/components/aula";
import { TechDetails } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { usePrefersReducedMotion } from "@/lib/motion";

import { PARTS, lessonSteps, type Chapter } from "./story";

export type RowState = "ahead" | "now" | "done";

export interface ChapterSignal {
  /** Last step on screen, steps.length when everything shows. */
  idx: number;
  total: number;
  /** The lesson is over (or was never started): the next key moves on. */
  done: boolean;
}

/** Add ?aula=1 to an in-app link while modo aula is on. */
export function appHref(href: string, aula: boolean): string {
  if (!aula) return href;
  return href.includes("?") ? `${href}&aula=1` : `${href}?aula=1`;
}

export function ChapterView({
  chapter,
  focused,
  cameFromBelow,
  onSignal,
  visuals = [],
  stage,
  details,
  source,
}: {
  chapter: Chapter;
  /** This chapter is the one in the middle of the screen. */
  focused: boolean;
  /** The reader arrived here scrolling up (aula shows the end, not step 1). */
  cameFromBelow: boolean;
  onSignal: (id: string, s: ChapterSignal) => void;
  /** One visual per step... */
  visuals?: ReactNode[];
  /** ...or one shared visual that changes with the step. */
  stage?: (idx: number, total: number) => ReactNode;
  details: ReactNode;
  /** Where the visuals' values come from, shown once under the steps. */
  source?: ReactNode;
}) {
  const { aula } = useAula();
  const reduced = usePrefersReducedMotion();
  const steps = useMemo(() => lessonSteps(chapter), [chapter]);
  const [runKey, setRunKey] = useState<number | null>(null);
  const lesson = useAulaLesson({
    id: `como-${chapter.id}`,
    steps,
    runKey,
    fastMs: 1300,
    reducedMotion: "pace",
  });
  const total = steps.length;
  const started = runKey !== null;

  // Everything shows until a run starts; outside aula a finished run goes
  // back to the full (static) view.
  const idx =
    !started || (lesson.step < 0 && !lesson.playing)
      ? total
      : lesson.done && !aula
        ? total
        : lesson.step;
  const staticView = idx >= total && !(aula && started);

  // Modo aula: start (or take back the caption bar) when the chapter reaches
  // the middle of the screen. Coming back from below shows the last step.
  const lessonRef = useRef(lesson);
  useEffect(() => {
    lessonRef.current = lesson;
  });
  useEffect(() => {
    if (!aula || !focused) return;
    if (runKey === null) {
      setRunKey(1);
      return;
    }
    lessonRef.current.replay();
    if (cameFromBelow) lessonRef.current.goTo(total - 1);
    // Only when focus arrives, not on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aula, focused]);

  useEffect(() => {
    onSignal(chapter.id, {
      idx,
      total,
      done: !started || lesson.done || idx >= total,
    });
  }, [chapter.id, idx, total, started, lesson.done, onSignal]);

  // In aula, keep the current step in view.
  const rowsRef = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    if (!aula || !started || idx < 0 || idx >= total) return;
    const el = rowsRef.current[idx];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const bar = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--aula-bar-h") || "0",
    );
    // On phones the shared visual (the map) sticks under the index: the
    // step has to show below it, not behind it.
    const stage = el.closest(".cf-ch")?.querySelector<HTMLElement>(".cf-stage");
    const stuck = stage && getComputedStyle(stage).position === "sticky";
    const top = stuck ? stage.getBoundingClientRect().bottom + 12 : 64;
    if (r.top < top || r.bottom > vh - bar - 16) {
      if (stuck) {
        const main = el.closest<HTMLElement>(".main");
        const scroller =
          main && main.scrollHeight > main.clientHeight
            ? main
            : document.scrollingElement;
        scroller?.scrollBy({ top: r.top - top, behavior: reduced ? "auto" : "smooth" });
      } else {
        el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      }
    }
  }, [aula, started, idx, total, reduced]);

  function play() {
    if (runKey === null) setRunKey(1);
    else lesson.replay();
  }

  const part = PARTS[chapter.part];
  const headingId = `${chapter.id}-t`;

  return (
    <section
      id={chapter.id}
      className="cf-ch"
      data-part={chapter.part}
      data-mode={staticView ? "static" : "lesson"}
      aria-labelledby={headingId}
    >
      <header className="cf-ch-head">
        <div className="cf-ch-titles">
          {/* Chapters are numbered (index, line at the top); the steps inside
              go by letter, so a chapter "1" never meets a step "1". */}
          <h2 id={headingId}>
            <span className="cf-ch-num">{chapter.n}</span>
            {chapter.title}
          </h2>
          <p className="cf-why">{chapter.why}</p>
          <p className="cf-who">
            <span className="cf-part-dot" aria-hidden="true" />
            {part.title} · {part.who}
          </p>
        </div>
      </header>

      <div className={stage ? "cf-body has-stage" : "cf-body"}>
        {stage ? (
          <div className="cf-stage">{stage(staticView ? total : idx, total)}</div>
        ) : null}
        <ol className="cf-steps">
          {chapter.steps.map((s, i) => {
            const state: RowState = i < idx ? "done" : i === idx ? "now" : "ahead";
            const shown = staticView ? "done" : state;
            return (
              <li
                key={s.title}
                ref={(el) => {
                  rowsRef.current[i] = el;
                }}
                className="cf-row"
                data-s={shown}
                aria-current={!staticView && state === "now" ? "step" : undefined}
              >
                <span className="cf-mark" aria-hidden="true">
                  {shown === "done" && !staticView ? (
                    <Icons.check sw={3} />
                  ) : (
                    stepLetter(i)
                  )}
                </span>
                <div className="cf-row-text">
                  <h3>{s.title}</h3>
                  <p>{s.line}</p>
                </div>
                {visuals[i] ? <div className="cf-vis">{visuals[i]}</div> : null}
              </li>
            );
          })}
        </ol>
      </div>
      {source ? <p className="cf-source">{source}</p> : null}

      <div className="cf-ch-foot">
        <Link
          className="btn btn-primary btn-sm cf-app"
          href={appHref(chapter.app.href, aula)}
        >
          {chapter.app.label}
          <Icons.arrowRight />
        </Link>
        {aula ? null : (
          <button type="button" className="btn btn-outline btn-sm" onClick={play}>
            <Icons.replay />
            {lesson.playing ? "Reproduzindo…" : "Reproduzir passo a passo"}
          </button>
        )}
        {!aula && lesson.playing ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={lesson.skip}>
            Pular
          </button>
        ) : null}
      </div>
      <TechDetails>{details}</TechDetails>
    </section>
  );
}

/** Steps go by letter (a, b, c), chapters by number. */
export function stepLetter(i: number): string {
  return String.fromCharCode(97 + i);
}

/** Small label that says where a value comes from. */
export function Origin({
  kind,
  children,
}: {
  kind: "demo" | "ilustrativo" | "ensaio" | "fora";
  children?: ReactNode;
}) {
  const label =
    kind === "demo"
      ? "dado do demo"
      : kind === "ensaio"
        ? "ensaio da palestra"
        : kind === "fora"
          ? "fora do demo"
          : "ilustrativo";
  return (
    <span className={`cf-origin is-${kind}`}>
      {kind === "fora" ? <Icons.external /> : <Icons.dot />}
      {children ?? label}
    </span>
  );
}
