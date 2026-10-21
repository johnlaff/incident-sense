"use client";

// The evaluation reveal: score ledger, weighted bar with the 8,0 gate, and the
// coherence analysis. Every number on screen comes from the API response; the
// motion only replays it in a teaching order (see sequence.ts).
import { useEffect, useState, type CSSProperties } from "react";

import { Icons } from "@/components/icons";
import { revealSubject } from "@/lib/reveal";
import {
  ADHERENCE_LABEL,
  band,
  nota,
  type Change,
  type Evaluation,
  type FieldKey,
} from "@/lib/changes";

import {
  DEFAULT_TIMING,
  avgDelta,
  fmt,
  fmtDelta,
  fmtWeight,
  formulaTerms,
  gatePassed,
  overallOf,
  parseTime,
  reached,
  decisionOf,
  verdictOf,
  type GateState,
  type Step,
  runningLine,
  type StepId,
  type WeightedAverage,
} from "./sequence";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* ------------------------------------------------------------------ *
 *  Motion tokens, read once per run so JS counters and CSS agree.
 * ------------------------------------------------------------------ */

export interface Motion {
  /** --motion-scale (1, or 1.6 in modo aula). */
  scale: number;
  /** Counter duration in ms, already scaled; 0 with reduced motion. */
  count: number;
  /** Gap between field counters in ms, already scaled. */
  stagger: number;
  /** Gap between formula terms in ms, already scaled. */
  term: number;
  /** One teaching visual in ms, already scaled; 0 with reduced motion. */
  explain: number;
  reduced: boolean;
}

export const STILL: Motion = {
  scale: 1,
  count: 0,
  stagger: 0,
  term: 0,
  explain: 0,
  reduced: true,
};

export function readMotion(): Motion {
  if (typeof window === "undefined") return STILL;
  const css = getComputedStyle(document.documentElement);
  const scale = parseFloat(css.getPropertyValue("--motion-scale")) || 1;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Reduced motion: no cascade inside a step; the step pacing stays (sequence.ts).
  const stagger = reduced
    ? 0
    : parseTime(css.getPropertyValue("--stagger-explain"), DEFAULT_TIMING.stagger) *
      scale;
  return {
    scale,
    reduced,
    stagger,
    // Formula terms use three explain staggers each, so each term can be read.
    term: stagger * 3,
    count: reduced
      ? 0
      : parseTime(css.getPropertyValue("--dur-count"), DEFAULT_TIMING.count) * scale,
    explain: reduced
      ? 0
      : parseTime(css.getPropertyValue("--dur-explain"), DEFAULT_TIMING.explain) * scale,
  };
}

/* ------------------------------------------------------------------ *
 *  Playback: the step index the screen reads. ChangeWorkspace builds it
 *  from useAulaLesson (components/aula.tsx), so modo aula drives it too.
 * ------------------------------------------------------------------ */

export interface Playback {
  /** -1 before the first step; steps.length once everything has settled. */
  index: number;
  /** The run is over (the last step played out, was reached, or skipped). */
  done: boolean;
  /** True when the viewer jumped to the end: counters skip their count. */
  skipped: boolean;
  /** Bumps on replay, used as a React key so the sequence remounts. */
  epoch: number;
  skip: () => void;
  replay: () => void;
}

/** Whole seconds since `running` turned true; a real clock, not progress. */
export function useElapsed(running: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) {
      setSince(null);
      return;
    }
    const t0 = Date.now();
    setSince(t0);
    setNow(t0);
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return since === null ? 0 : Math.floor((now - since) / 1000);
}

/* ------------------------------------------------------------------ *
 *  Counter: counts from `from` to `to`, ease-out, at most --dur-count.
 * ------------------------------------------------------------------ */

function useCount(to: number, from: number, run: boolean, delay: number, dur: number) {
  const [value, setValue] = useState(from);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    setFinished(false);
    if (!run) {
      setValue(from);
      return;
    }
    if (dur <= 0) {
      const id = window.setTimeout(() => {
        setValue(to);
        setFinished(true);
      }, delay);
      return () => window.clearTimeout(id);
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    setValue(from);
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setFinished(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, from, run, delay, dur]);
  return { value, finished };
}

function ScoreChip({
  score,
  from = 0,
  run,
  delay,
  dur,
  big = false,
  places = 1,
  label,
  neutral = false,
}: {
  score: number;
  from?: number;
  run: boolean;
  delay: number;
  dur: number;
  big?: boolean;
  /** Decimal places; the overall uses two, like the formula under it. */
  places?: number;
  label: string;
  /** No hue: the verdict, not this number, says yes or no. */
  neutral?: boolean;
}) {
  const { value, finished } = useCount(score, from, run, delay, dur);
  const cls = big ? "chg-overall-num" : "chg-score";
  return (
    <span
      className={`${cls} ${finished ? (neutral ? "neutral" : band(score, places)) : "counting"}`}
      data-on={run}
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">{fmt(value, places)}</span>
    </span>
  );
}

/** Field score chip used by the field cards; same timing as the ledger. */
export function FieldScoreChip({
  score,
  from,
  reused,
  run,
  order,
  skipped,
  motion,
}: {
  score: number;
  from?: number;
  reused: boolean;
  run: boolean;
  order: number;
  skipped: boolean;
  motion: Motion;
}) {
  return (
    <ScoreChip
      score={score}
      from={from ?? 0}
      run={run}
      delay={skipped ? 0 : order * motion.stagger}
      dur={skipped || reused ? 0 : motion.count}
      label={`Nota ${nota(score)} de 10`}
    />
  );
}

export function DeltaChip({
  delta,
  places = 1,
}: {
  delta: number | null;
  places?: number;
}) {
  if (delta === null) return null;
  const kind = delta > 0 ? "up" : delta < 0 ? "down" : "same";
  return (
    <span
      className={`chg-delta ${kind}`}
      aria-label={
        delta === 0
          ? "Nota igual à da avaliação anterior"
          : `${delta > 0 ? "Subiu" : "Caiu"} ${fmt(Math.abs(delta), places)} desde a avaliação anterior`
      }
    >
      <span aria-hidden="true">{fmtDelta(delta, places)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 *  Running state: the request is in flight. One honest indicator,
 *  a real clock, and the structure of what is being judged.
 * ------------------------------------------------------------------ */

export function RunningNote({ seconds, fields }: { seconds: number; fields: number }) {
  return (
    <p className="chg-running" role="status">
      <Icons.loader className="spin" />
      <span>{runningLine(fields)}</span>
      <span className="chg-elapsed" aria-label={`${seconds} segundos`}>
        {seconds} s
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 *  Playback bar: says the result already arrived and is being replayed.
 * ------------------------------------------------------------------ */

export function PlaybackBar({
  steps,
  playback,
  seconds,
  instant = false,
}: {
  steps: Step[];
  playback: Playback;
  seconds: number;
  /** The result showed at once (outside modo aula): offer the walk-through. */
  instant?: boolean;
}) {
  const playing = !playback.done;
  const step = steps[Math.max(0, Math.min(playback.index, steps.length - 1))];
  // A reused reading comes back in no time; "0,0 s" reads like a glitch.
  const took = seconds >= 0.1 ? `Resultado em ${fmt(seconds, 1)} s` : "Resultado pronto";
  return (
    <div className="chg-playbar" aria-live="polite">
      {playing ? (
        <>
          <p>
            <span className="chg-playbar-count">
              Passo {Math.max(1, playback.index + 1)} de {steps.length}
            </span>
            <span>{step.title}</span>
          </p>
          <button className="btn btn-ghost btn-sm" onClick={playback.skip}>
            Pular para o fim
          </button>
        </>
      ) : (
        <>
          <p>
            <span className="chg-playbar-count">{took}</span>
            {!instant && <span>{steps.length} etapas repassadas</span>}
          </p>
          <button className="btn btn-ghost btn-sm" onClick={playback.replay}>
            <Icons.replay />
            Rever os passos
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Ledger: one row per field, label + weight + score, in order.
 * ------------------------------------------------------------------ */

export interface LedgerRow {
  key: FieldKey;
  label: string;
  weight: number;
}

export function Ledger({
  rows,
  avg,
  previous,
  run,
  skipped,
  motion,
  flagBelow,
  threshold,
  caption,
  why,
  pending = null,
}: {
  rows: LedgerRow[];
  avg: WeightedAverage | null;
  previous: Map<FieldKey, number>;
  run: boolean;
  skipped: boolean;
  motion: Motion;
  flagBelow: boolean;
  threshold: number;
  caption: string | null;
  /**
   * One-line reason per field. When given (outside modo aula, result in),
   * the rows read worst first, each with a bar against the 8,0 line.
   */
  why?: Map<FieldKey, string> | null;
  /** Fields edited since this result: their score is the old text's. */
  pending?: Set<FieldKey> | null;
}) {
  const byKey = new Map(avg?.segments.map((s) => [s.key, s]) ?? []);
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);
  const detail = Boolean(why) && avg !== null;
  const ordered = detail
    ? [...rows].sort(
        (a, b) => (byKey.get(a.key)?.score ?? 0) - (byKey.get(b.key)?.score ?? 0),
      )
    : rows;
  return (
    <div className={`chg-ledger${detail ? " detail" : ""}`}>
      <h3>
        {detail ? "Nota de cada campo, da pior para a melhor" : "Nota de cada campo"}
      </h3>
      {caption && <p className="chg-caption">{caption}</p>}
      {!caption && (
        <p className="chg-caption">
          <b>Peso</b> é quanto o campo conta na média. Os pesos somam{" "}
          <span className="num">{fmtWeight(totalWeight)}</span>.
        </p>
      )}
      <ol>
        {ordered.map((r, i) => {
          const seg = byKey.get(r.key);
          const prev = previous.get(r.key);
          const below =
            (flagBelow || detail) && seg !== undefined && seg.score < threshold;
          const line = detail ? why?.get(r.key) : undefined;
          const edited = pending?.has(r.key) ?? false;
          return (
            <li
              key={r.key}
              className={`chg-led-row${below ? " flag" : ""}${edited ? " edited" : ""}`}
              data-on={run && seg !== undefined}
              style={{ "--i": i } as Vars}
            >
              <a href={`#campo-${r.key}`} className="chg-led-link">
                <span className="chg-led-label">
                  <span>{r.label}</span>
                  <span className="chg-led-meta">
                    peso {fmtWeight(seg?.weight ?? r.weight)} de {fmtWeight(totalWeight)}
                    {seg?.reused && run && (
                      <span
                        className="chg-reused"
                        title="O texto não mudou, então a nota foi reaproveitada sem chamar a IA"
                      >
                        reaproveitado
                      </span>
                    )}
                    {below && <span className="chg-below">abaixo de 8,0</span>}
                    {edited && <span className="chg-edited">editado: reavalie</span>}
                  </span>
                  {detail && seg && (
                    <span
                      className={`chg-led-bar ${band(seg.score)}`}
                      style={{ "--sc": seg.score, "--cut": threshold } as Vars}
                      aria-hidden="true"
                    >
                      <span className="fill" />
                      <span className="tick" />
                    </span>
                  )}
                  {line && <span className="chg-led-why">{line}</span>}
                </span>
                <span className="chg-led-score">
                  {seg ? (
                    <>
                      <FieldScoreChip
                        score={seg.score}
                        from={prev}
                        reused={seg.reused}
                        run={run}
                        order={i}
                        skipped={skipped}
                        motion={motion}
                      />
                      {run && !seg.reused && <DeltaChip delta={seg.delta} />}
                    </>
                  ) : prev !== undefined ? (
                    <span className="chg-score stale" aria-label="Aguardando a nova nota">
                      {nota(prev)}
                    </span>
                  ) : (
                    <span className="chg-score empty" aria-label="Aguardando a nota" />
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Weighted average: segments, formula, pointer and the 8,0 gate.
 * ------------------------------------------------------------------ */

export function Average({
  result,
  avg,
  previousAvg,
  previousOverall,
  index,
  steps,
  skipped,
  motion,
  aula = false,
}: {
  result: Evaluation;
  avg: WeightedAverage;
  previousAvg: WeightedAverage | null;
  previousOverall: number | null;
  index: number;
  steps: Step[];
  skipped: boolean;
  motion: Motion;
  /** Modo aula opens the formula; elsewhere it waits behind "Ver a conta". */
  aula?: boolean;
}) {
  const at = (id: StepId) => reached(steps, index, id);
  const onMedia = at("media");
  const onGate = at("portao");
  // Same number as the formula's result: one source for headline, bar and gate.
  const overall = overallOf(result) ?? 0;
  const passed = gatePassed(result);
  // Green only when the whole reading says yes: past the cut, a blocked
  // coherence check keeps the line neutral and the verdict carries the color.
  const finalOk = verdictOf(result)?.ok ?? false;
  const gate = passed ? (finalOk ? "open" : "neutral") : "closed";
  const n = avg.segments.length;
  const terms = formulaTerms(avg);
  const before = new Map(previousAvg?.segments.map((s) => [s.key, s]) ?? []);
  const landDelay = skipped ? 0 : (n - 1) * motion.term + motion.explain;
  const cut = nota(result.threshold);
  // 7,96 reads as "8,0" once rounded, yet it is below the cut: say so.
  const roundsToCut = !passed && nota(overall) === cut;

  return (
    <div
      className="chg-avg"
      style={
        {
          "--v": overall,
          "--v0": previousOverall ?? 0,
          "--cut": result.threshold,
          "--n": n,
          "--land-delay": `${landDelay}ms`,
        } as Vars
      }
    >
      <h3>Média ponderada</h3>
      <p className="chg-caption">Campos mais importantes pesam mais.</p>

      <div className="chg-avg-head">
        <ScoreChip
          big
          score={overall}
          from={previousOverall ?? 0}
          run={onMedia}
          delay={landDelay}
          dur={skipped ? 0 : motion.count}
          places={2}
          neutral={passed && !finalOk}
          label={`Média ponderada ${fmt(overall, 2)} de 10`}
        />
        <span className="chg-overall-label">
          média ponderada
          <br />
          dos {n} campos
        </span>
        {previousOverall !== null && onMedia && (
          <span className="chg-avg-before">
            antes {fmt(previousOverall, 2)}
            <DeltaChip delta={avgDelta(overall, previousOverall)} places={2} />
          </span>
        )}
      </div>

      <div
        className="chg-scale"
        data-on={onMedia}
        data-gate={onGate ? gate : "idle"}
        role="img"
        aria-label={`Régua de 0 a 10: média ${fmt(overall, 2)}, mínimo para seguir ${cut}. ${
          passed ? "Passou do mínimo." : "Ficou abaixo do mínimo."
        }`}
      >
        <span className="chg-pointer" aria-hidden="true">
          <svg viewBox="0 0 12 8" width="12" height="8">
            <path d="M0 0h12L6 8Z" fill="currentColor" />
          </svg>
        </span>
        <div className="chg-bar" aria-hidden="true">
          {avg.segments.map((s, i) => {
            const old = before.get(s.key);
            return (
              <span
                key={s.key}
                className={`chg-segment${i % 2 ? " alt" : ""}`}
                style={
                  {
                    "--i": i,
                    "--s": s.start,
                    "--e": s.end,
                    "--s0": old ? old.start : s.start,
                    "--e0": old ? old.end : s.start,
                  } as Vars
                }
              />
            );
          })}
        </div>
        <span className="chg-door" aria-hidden="true">
          <span className="top" />
          <span className="bot" />
        </span>
        <span className="chg-axis" aria-hidden="true">
          <span style={{ "--at": 0 } as Vars}>0</span>
          <span style={{ "--at": 5 } as Vars}>5</span>
          <span className="cut" style={{ "--at": result.threshold } as Vars}>
            {cut}
          </span>
          <span style={{ "--at": 10 } as Vars}>10</span>
        </span>
      </div>

      <p className="chg-scale-key">
        <span className="tick" aria-hidden="true" />
        Linha em {cut}: mínimo para seguir
      </p>

      <details className="chg-conta" open={aula || undefined}>
        <summary>Ver a conta</summary>
        <p className="chg-formula" data-on={onMedia} aria-label={formulaLabel(avg)}>
          <span className="chg-formula-terms" aria-hidden="true">
            {terms.map((t, i) => (
              <span
                key={avg.segments[i].key}
                className="chg-term"
                style={{ "--i": i } as Vars}
              >
                {i > 0 && <span className="op">+</span>}
                <span>
                  {i === 0 && <span className="paren">(</span>}
                  <span className={`t${i % 2 ? " alt" : ""}`}>{t}</span>
                  {i === n - 1 && <span className="paren">)</span>}
                </span>
              </span>
            ))}
            <span className="chg-term div" style={{ "--i": n } as Vars}>
              <span className="op">÷</span>
              <span className="t">{fmtWeight(avg.totalWeight)}</span>
            </span>
          </span>
          <span
            className="chg-formula-result"
            aria-hidden="true"
            style={{ "--i": n + 1 } as Vars}
          >
            = {fmt(avg.numerator, 2)} ÷ {fmtWeight(avg.totalWeight)} ={" "}
            <b>{fmt(overall, 2)}</b>
          </span>
        </p>
      </details>

      {onGate &&
        (aula ? (
          <p className={`chg-gate ${gate}`}>
            {passed ? <LockOpen /> : <LockClosed />}
            <span>
              {passed ? (
                <>
                  <b>Pergunta 1: sim, chegou a {cut}.</b> Agora a IA confere se as partes
                  do pedido combinam.
                </>
              ) : (
                <>
                  <b>Pergunta 1: não, ficou abaixo de {cut}.</b>{" "}
                  {roundsToCut
                    ? `${fmt(overall, 2)} ainda é menos que ${cut}.`
                    : `Faltam ${fmt(result.threshold - overall, 2)} pontos para ${cut}.`}{" "}
                  Melhore os campos de nota mais baixa.
                </>
              )}
            </span>
          </p>
        ) : (
          <p className="chg-gate neutral">
            {passed ? <LockOpen /> : <LockClosed />}
            <span>
              {passed
                ? "Daqui a IA passa para a pergunta 2: as partes do pedido combinam?"
                : roundsToCut
                  ? `${fmt(overall, 2)} ainda é menos que ${cut}. Os campos de nota mais baixa são os que mais ajudam a subir.`
                  : `Faltam ${fmt(result.threshold - overall, 2)} pontos para ${cut}. Os campos de nota mais baixa são os que mais ajudam a subir.`}
            </span>
          </p>
        ))}
    </div>
  );
}

function formulaLabel(avg: WeightedAverage): string {
  const terms = avg.segments
    .map((s) => `${fmt(s.score)} vezes ${fmtWeight(s.weight)}`)
    .join(", mais ");
  return `Conta: ${terms}, dividido por ${fmtWeight(avg.totalWeight)}, dá ${fmt(avg.average, 2)}.`;
}

/* ------------------------------------------------------------------ *
 *  Coherence: only after the gate. Closed gate says why it stopped.
 * ------------------------------------------------------------------ */

export function Coherence({
  result,
  change,
  index,
  steps,
  skipped,
  motion,
}: {
  result: Evaluation;
  /** The record, for the two texts the check compares. */
  change?: Change;
  index: number;
  steps: Step[];
  skipped: boolean;
  motion: Motion;
}) {
  const s = result.semantic;
  const passed = decisionOf(result)?.average.state === "pass";
  const onScores = reached(steps, index, "coerencia");
  const onProblems = reached(steps, index, "problemas");

  if (!passed || !s) {
    return (
      <section
        id="coerencia"
        className="card chg-semantic locked"
        aria-labelledby="sem-h"
      >
        <header className="chg-sem-head">
          <LockClosed />
          <h2 id="sem-h">Coerência entre os campos</h2>
        </header>
        <p className="chg-sem-stop">
          Não conferida: ela só roda quando a média chega ao mínimo.
        </p>
        {result.semantic_skipped_reason && (
          <p className="chg-muted">{plainReason(result.semantic_skipped_reason)}</p>
        )}
      </section>
    );
  }

  const combine = decisionOf(result)?.coherence.state === "pass";
  return (
    <section
      id="coerencia"
      className={`card chg-semantic open${combine ? "" : " blocked"}`}
      aria-labelledby="sem-h"
    >
      <header className="chg-sem-head">
        <LockOpen />
        <h2 id="sem-h">Coerência entre os campos</h2>
        {s.reused && <span className="chg-reused">reaproveitada: nada mudou</span>}
      </header>
      <p className="chg-caption">O plano de retorno desfaz o que as tarefas fazem?</p>

      <div className="chg-sem-scores" data-on={onScores}>
        <div className="chg-sem-tile">
          <ScoreChip
            score={s.consistency_score}
            run={onScores}
            delay={0}
            dur={skipped ? 0 : motion.count}
            label={`Coerência ${nota(s.consistency_score)} de 10`}
          />
          <span>{"coerência entre os campos, de\u00a00\u00a0a\u00a010"}</span>
        </div>
        <div className="chg-sem-tile chg-adh-tile">
          <div className="chg-adh-row">
            <span className={`chg-adh-label ${s.backout_adherence}`}>
              {s.backout_adherence === "ADERENTE" ? (
                <Icons.checkCircle />
              ) : (
                <Icons.alert />
              )}
              {ADHERENCE_LABEL[s.backout_adherence]}
            </span>
          </div>
          <span
            className={`chg-adh-meter ${s.backout_adherence}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={s.backout_adherence_percent}
            aria-label="Quanto do que as tarefas fazem o plano de retorno desfaz"
            style={{ "--pct": s.backout_adherence_percent } as Vars}
          >
            <span className="fill" />
          </span>
          {/* A second, narrower fact than the 0 to 10 coherence, the same one
              the prompt asks for: how much of what the registered tasks do the
              back-out plan undoes. */}
          <span>
            O plano de retorno desfaz{" "}
            <b className="num">{s.backout_adherence_percent}%</b> do que as tarefas
            cadastradas fazem
          </span>
        </div>
      </div>

      <div
        className="chg-sem-body"
        data-on={onProblems}
        style={{ "--n": Math.max(1, s.problems.length) } as Vars}
      >
        <h3>
          {combine ? "Pontos de atenção (não impedem)" : "Onde as partes não combinam"}
        </h3>
        {s.problems.length > 0 ? (
          <ol className={`chg-problems${combine ? " soft" : ""}`}>
            {s.problems.map((p, i) => (
              <li key={`${i}-${p}`} style={{ "--i": i } as Vars}>
                <span className="n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        ) : combine ? (
          <p className="chg-none">
            <Icons.checkCircle />
            Nada se contradiz entre as partes do pedido.
          </p>
        ) : (
          <p>A IA não listou pontos, mas a nota de coerência ficou abaixo do mínimo.</p>
        )}
        {change && aboutBackout(s) ? <Excerpts change={change} /> : null}
        {s.reasoning.trim() ? (
          <>
            <h3>Raciocínio</h3>
            <p>{s.reasoning}</p>
          </>
        ) : null}
        {s.guidance.trim() ? (
          <>
            <h3>Orientação ao autor</h3>
            <p>{s.guidance}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The two texts (tasks and back-out plan) help only when the reading is
 * about them: the back-out plan falls short, or a point names it.
 */
function aboutBackout(s: NonNullable<Evaluation["semantic"]>): boolean {
  return (
    s.backout_adherence !== "ADERENTE" ||
    s.problems.some((p) =>
      /retorno|revers|reverte|desfa|rollback|backout|tarefa/i.test(p),
    )
  );
}

/** Where "Ver onde" takes the reader: the worst fields, or the coherence card. */
const FAILING_TARGET = { average: ".chg-ledger", coherence: "#coerencia" } as const;

function showFailing(where: keyof typeof FAILING_TARGET) {
  const el = document.querySelector<HTMLElement>(FAILING_TARGET[where]);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  revealSubject(el, reduced);
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

function GateRow({
  n,
  question,
  value,
  state,
  note,
  where,
}: {
  n: 1 | 2;
  question: string;
  value: string | null;
  state: GateState;
  note?: string;
  where: keyof typeof FAILING_TARGET;
}) {
  const said = state === "pass" ? "sim" : state === "fail" ? "não" : "não conferido";
  return (
    <li className={`chg-q ${state}`}>
      <span className="chg-q-text">
        <span className="num">{n}.</span> {question}
      </span>
      <span className="chg-q-answer">
        {value !== null && <b className="num">{value}</b>}
        {state === "pass" ? (
          <Icons.checkCircle />
        ) : state === "fail" ? (
          <Icons.xCircle />
        ) : null}
        <span className={value !== null ? "sr-only" : "chg-q-skip"}>{said}</span>
      </span>
      {note && <span className="chg-q-note">{note}</span>}
      {state === "fail" && (
        <a
          className="chg-q-where"
          href={FAILING_TARGET[where]}
          onClick={(e) => {
            e.preventDefault();
            showFailing(where);
          }}
        >
          Ver onde
        </a>
      )}
    </li>
  );
}

/**
 * The answer of the reading, as the rule itself: two questions, then the
 * verdict. Outside modo aula it opens the result; in modo aula it closes it.
 * The failing question is the only thing on the page drawn in red.
 */
export function Decision({
  result,
  closing = false,
}: {
  result: Evaluation;
  /** Modo aula: the last block of the lesson, after the numbers. */
  closing?: boolean;
}) {
  const d = decisionOf(result);
  const v = verdictOf(result);
  if (!d || !v) return null;
  const cut = fmt(d.cut);
  const c = d.coherence;
  return (
    <section
      className={`chg-banner ${v.ok ? "ok" : "no"}${closing ? " closing" : ""}`}
      role="status"
      aria-labelledby="decide-h"
    >
      <h2 id="decide-h" className="chg-decide-h">
        Duas perguntas decidem
      </h2>
      <ol className="chg-gates">
        <GateRow
          n={1}
          question={`A média passa de ${cut}?`}
          value={fmt(d.average.value, 2)}
          state={d.average.state}
          where="average"
        />
        <GateRow
          n={2}
          question="As partes do pedido combinam?"
          value={c.value === null ? null : fmt(c.value)}
          state={c.state}
          note={
            c.state === "skipped"
              ? d.average.state === "fail"
                ? "Só é perguntado quando a 1 passa."
                : "A conferência não rodou."
              : c.adherence === "NAO_ADERENTE"
                ? "O plano de retorno não desfaz o que a implementação muda."
                : `Coerência de 0 a 10, mesmo corte de ${cut}.`
          }
          where="coherence"
        />
      </ol>
      <div className="chg-outcome">
        <svg
          className="chg-outcome-arrow"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path
            d="M8 2v11M3.5 8.5 8 13l4.5-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <p className="chg-banner-title">
            {v.ok ? <Icons.checkCircle /> : null}
            {v.title}
          </p>
          <p className="chg-banner-reason">{v.reason}</p>
        </div>
      </div>
      <p className="chg-banner-human">
        <Icons.human />A IA recomenda, quem decide é uma pessoa.
      </p>
    </section>
  );
}

/** What the coherence check compares, side by side on a wide screen. */
function Excerpts({ change }: { change: Change }) {
  return (
    <details className="chg-excerpts">
      <summary>Os dois textos que a IA comparou</summary>
      <div className="chg-excerpts-grid">
        <div>
          <p className="chg-excerpt-label">O que as tarefas fazem</p>
          <ol className="chg-excerpt-tasks">
            {change.tasks.map((t) => (
              <li key={t.number}>{t.short_description}</li>
            ))}
          </ol>
        </div>
        <div>
          <p className="chg-excerpt-label">O que o plano de retorno desfaz</p>
          <p className="chg-excerpt-text">{change.backout_plan}</p>
        </div>
      </div>
    </details>
  );
}

/** The backend writes "Nota 1.0"; show the decimal comma the rest of the UI uses. */
function plainReason(reason: string): string {
  return reason.replace(/(\d+)\.(\d+)/g, "$1,$2");
}

function LockClosed() {
  return (
    <svg
      className="chg-lock-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function LockOpen() {
  return (
    <svg
      className="chg-lock-icon open"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path className="shackle" d="M8 11V8a4 4 0 0 1 7.8-1.2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 *  Follow the step: during playback, keep the block that is speaking
 *  in view (the aside scrolls on desktop, the page on a phone). Stops
 *  for good as soon as the viewer scrolls or presses a key themselves.
 * ------------------------------------------------------------------ */

const STEP_TARGET: Record<StepId, string> = {
  notas: ".chg-ledger",
  media: ".chg-scale",
  portao: ".chg-gate",
  coerencia: ".chg-sem-scores",
  // The list of points ends in the two questions and the verdict: show both.
  problemas: ".chg-banner",
};

export function useFollowStep(
  steps: Step[],
  index: number,
  runKey: string,
  reduced: boolean,
  { aula = false, gateClosed = false }: { aula?: boolean; gateClosed?: boolean } = {},
): void {
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  // In modo aula the keys drive the lesson, so a key press never stops the
  // follow, and the subject always comes into view before the caption.
  const stopped = stoppedFor === runKey && !aula;

  useEffect(() => {
    if (stopped || aula) return;
    const stop = () => setStoppedFor(runKey);
    const opts = { passive: true, once: true } as const;
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchmove", stop, opts);
    window.addEventListener("keydown", stop, opts);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [runKey, stopped, aula]);

  // A lesson in modo aula ends as soon as its last step shows: keep following
  // that last step instead of dropping it.
  const at = aula ? Math.min(index, steps.length - 1) : index;
  const id = at >= 0 && at < steps.length ? steps[at].id : null;
  useEffect(() => {
    // Outside modo aula the page never scrolls on its own while the reader reads.
    if (!aula || stopped || id === null) return;
    // A closed gate ends the reading: its verdict is the subject.
    const sel = id === "portao" && gateClosed ? ".chg-banner" : STEP_TARGET[id];
    // Wait one frame so a block that just mounted has its size.
    let cancel = () => {};
    const raf = requestAnimationFrame(() => {
      cancel = revealSubject(document.querySelector(sel), reduced);
    });
    return () => {
      cancelAnimationFrame(raf);
      cancel();
    };
  }, [id, at, stopped, reduced, gateClosed, aula]);
}
