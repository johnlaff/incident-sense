"use client";

// The evaluation reveal: score ledger, weighted bar with the 8,0 gate, and the
// coherence analysis. Every number on screen comes from the API response; the
// motion only replays it in a teaching order (see sequence.ts).
import { useEffect, useState, type CSSProperties } from "react";

import { Icons } from "@/components/icons";
import {
  ADHERENCE_LABEL,
  band,
  nota,
  type Evaluation,
  type FieldKey,
} from "@/lib/changes";

import {
  DEFAULT_TIMING,
  fmt,
  fmtDelta,
  fmtWeight,
  formulaTerms,
  gatePassed,
  parseTime,
  reached,
  type Step,
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
 *  Playback: a local step index over the pure step list.
 *  Wiring to modo aula later: replace this hook with useAula(steps).
 * ------------------------------------------------------------------ */

export interface Playback {
  /** -1 before the first step; steps.length once everything has settled. */
  index: number;
  /** True when the viewer jumped to the end: counters skip their count. */
  skipped: boolean;
  /** Bumps on replay, used as a React key so the sequence remounts. */
  epoch: number;
  skip: () => void;
  replay: () => void;
}

export function usePlayback(steps: Step[], runKey: number, scale: number): Playback {
  const [state, setState] = useState({
    key: runKey,
    index: -1,
    skipped: false,
    epoch: 0,
  });
  const current =
    state.key === runKey ? state : { key: runKey, index: -1, skipped: false, epoch: 0 };

  useEffect(() => {
    if (steps.length === 0 || current.index >= steps.length) return;
    // Step -1 lasts one frame so the first step's entrance actually plays.
    const wait = current.index < 0 ? 40 : steps[current.index].ms * scale;
    const id = window.setTimeout(
      () => setState({ ...current, index: current.index + 1 }),
      wait,
    );
    return () => window.clearTimeout(id);
    // `current` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.index, current.key, current.epoch, steps, scale]);

  return {
    index: current.index,
    skipped: current.skipped,
    epoch: current.epoch,
    skip: () => setState({ ...current, index: steps.length, skipped: true }),
    replay: () =>
      setState({ ...current, index: -1, skipped: false, epoch: current.epoch + 1 }),
  };
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
  label,
}: {
  score: number;
  from?: number;
  run: boolean;
  delay: number;
  dur: number;
  big?: boolean;
  label: string;
}) {
  const { value, finished } = useCount(score, from, run, delay, dur);
  const cls = big ? "chg-overall-num" : "chg-score";
  return (
    <span
      className={`${cls} ${finished ? band(score) : "counting"}`}
      data-on={run}
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">{nota(value)}</span>
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

export function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const kind = delta > 0 ? "up" : delta < 0 ? "down" : "same";
  return (
    <span
      className={`chg-delta ${kind}`}
      aria-label={
        delta === 0
          ? "Nota igual à da avaliação anterior"
          : `${delta > 0 ? "Subiu" : "Caiu"} ${fmt(Math.abs(delta))} desde a avaliação anterior`
      }
    >
      <span aria-hidden="true">{fmtDelta(delta)}</span>
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
      <span>
        A IA está lendo os {fields} campos em paralelo, no servidor. As notas chegam todas
        juntas.
      </span>
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
}: {
  steps: Step[];
  playback: Playback;
  seconds: number;
}) {
  const playing = playback.index < steps.length;
  const step = steps[Math.max(0, Math.min(playback.index, steps.length - 1))];
  const took = fmt(seconds, 1);
  return (
    <div className="chg-playbar" aria-live="polite">
      {playing ? (
        <>
          <p>
            <span className="chg-playbar-count">
              Etapa {Math.max(1, playback.index + 1)} de {steps.length}
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
            <span className="chg-playbar-count">Resultado em {took} s</span>
            <span>{steps.length} etapas repassadas</span>
          </p>
          <button className="btn btn-ghost btn-sm" onClick={playback.replay}>
            <Icons.replay />
            Repassar
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
}) {
  const byKey = new Map(avg?.segments.map((s) => [s.key, s]) ?? []);
  return (
    <div className="chg-ledger">
      <h3>Nota de cada campo</h3>
      {caption && <p className="chg-caption">{caption}</p>}
      <ol>
        {rows.map((r, i) => {
          const seg = byKey.get(r.key);
          const prev = previous.get(r.key);
          const below = flagBelow && seg !== undefined && seg.score < threshold;
          return (
            <li
              key={r.key}
              className={`chg-led-row${below ? " flag" : ""}`}
              data-on={run && seg !== undefined}
              style={{ "--i": i } as Vars}
            >
              <a href={`#campo-${r.key}`} className="chg-led-link">
                <span className="chg-led-label">
                  <span>{r.label}</span>
                  <span className="chg-led-meta">
                    peso {fmtWeight(r.weight)}
                    {seg?.reused && run && (
                      <span
                        className="chg-reused"
                        title="O texto não mudou, então a nota foi reaproveitada sem chamar a IA"
                      >
                        reaproveitado
                      </span>
                    )}
                    {below && <span className="chg-below">abaixo do corte</span>}
                  </span>
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
}: {
  result: Evaluation;
  avg: WeightedAverage;
  previousAvg: WeightedAverage | null;
  previousOverall: number | null;
  index: number;
  steps: Step[];
  skipped: boolean;
  motion: Motion;
}) {
  const at = (id: StepId) => reached(steps, index, id);
  const onMedia = at("media");
  const onGate = at("portao");
  const overall = result.overall ?? 0;
  const passed = gatePassed(result);
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
      <p className="chg-caption">
        Campos mais importantes pesam mais. Cada pedaço da barra é nota × peso, dividido
        pela soma dos pesos.
      </p>

      <div className="chg-avg-head">
        <ScoreChip
          big
          score={overall}
          from={previousOverall ?? 0}
          run={onMedia}
          delay={landDelay}
          dur={skipped ? 0 : motion.count}
          label={`Média ponderada ${nota(overall)} de 10`}
        />
        <span className="chg-overall-label">
          média ponderada
          <br />
          dos {n} campos
        </span>
        {previousOverall !== null && onMedia && (
          <span className="chg-avg-before">
            antes {nota(previousOverall)}
            <DeltaChip delta={Math.round((overall - previousOverall) * 10) / 10} />
          </span>
        )}
      </div>

      <div
        className="chg-scale"
        data-on={onMedia}
        data-gate={onGate ? (passed ? "open" : "closed") : "idle"}
        role="img"
        aria-label={`Barra de 0 a 10: média ${nota(overall)}, corte em ${cut}. ${
          passed ? "Passou do corte." : "Ficou abaixo do corte."
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
            corte {cut}
          </span>
          <span style={{ "--at": 10 } as Vars}>10</span>
        </span>
      </div>

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
          <b>{fmt(avg.average, 2)}</b>
        </span>
      </p>

      {onGate && (
        <p className={`chg-gate ${passed ? "open" : "closed"}`}>
          {passed ? <LockOpen /> : <LockClosed />}
          <span>
            {passed ? (
              <>
                <b>Passou do corte de {cut}.</b> A análise de coerência roda.
              </>
            ) : (
              <>
                <b>Abaixo do corte: a análise de coerência não roda.</b>{" "}
                {roundsToCut
                  ? `${fmt(overall, 2)} ainda é menos que ${cut}.`
                  : `Faltam ${fmt(result.threshold - overall)} pontos para ${cut}.`}{" "}
                Melhore os campos marcados.
              </>
            )}
          </span>
        </p>
      )}
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
  index,
  steps,
  skipped,
  motion,
}: {
  result: Evaluation;
  index: number;
  steps: Step[];
  skipped: boolean;
  motion: Motion;
}) {
  const s = result.semantic;
  const passed = gatePassed(result);
  const onScores = reached(steps, index, "coerencia");
  const onProblems = reached(steps, index, "problemas");

  if (!passed || !s) {
    return (
      <section className="card chg-semantic locked" aria-labelledby="sem-h">
        <header className="chg-sem-head">
          <LockClosed />
          <h2 id="sem-h">Coerência entre os campos</h2>
        </header>
        <p className="chg-sem-stop">Abaixo do corte: a análise de coerência não roda.</p>
        {result.semantic_skipped_reason && (
          <p className="chg-muted">{plainReason(result.semantic_skipped_reason)}</p>
        )}
      </section>
    );
  }

  return (
    <section className="card chg-semantic open" aria-labelledby="sem-h">
      <header className="chg-sem-head">
        <LockOpen />
        <h2 id="sem-h">Coerência entre os campos</h2>
        {s.reused && <span className="chg-reused">reaproveitada: nada mudou</span>}
      </header>
      <p className="chg-caption">
        A IA lê os campos juntos e confere se contam a mesma história. O plano de retorno
        precisa desfazer o que as tarefas fazem.
      </p>

      <div className="chg-sem-scores" data-on={onScores}>
        <div className="chg-sem-tile">
          <ScoreChip
            score={s.consistency_score}
            run={onScores}
            delay={0}
            dur={skipped ? 0 : motion.count}
            label={`Consistência ${nota(s.consistency_score)} de 10`}
          />
          <span>consistência entre os campos, de 0 a 10</span>
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
            <span className="chg-adh-pct">{s.backout_adherence_percent}%</span>
          </div>
          <span
            className={`chg-adh-meter ${s.backout_adherence}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={s.backout_adherence_percent}
            aria-label="Aderência do plano de retorno às tarefas"
            style={{ "--pct": s.backout_adherence_percent } as Vars}
          >
            <span className="fill" />
          </span>
          <span>plano de retorno x tarefas cadastradas</span>
        </div>
      </div>

      <div
        className="chg-sem-body"
        data-on={onProblems}
        style={{ "--n": Math.max(1, s.problems.length) } as Vars}
      >
        <h3>Incoerências</h3>
        {s.problems.length > 0 ? (
          <ol className="chg-problems">
            {s.problems.map((p, i) => (
              <li key={p} style={{ "--i": i } as Vars}>
                <span className="n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="chg-none">
            <Icons.checkCircle />
            Nenhuma incoerência apontada.
          </p>
        )}
        <h3>Raciocínio</h3>
        <p>{s.reasoning}</p>
        <h3>Orientação ao autor</h3>
        <p>{s.guidance}</p>
      </div>
    </section>
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
  problemas: ".chg-sem-body",
};

export function useFollowStep(
  steps: Step[],
  index: number,
  runKey: string,
  reduced: boolean,
): void {
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  const stopped = stoppedFor === runKey;

  useEffect(() => {
    if (stopped) return;
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
  }, [runKey, stopped]);

  useEffect(() => {
    if (stopped || index < 0 || index >= steps.length) return;
    const el = document.querySelector(STEP_TARGET[steps[index].id]);
    // Wait one frame so a block that just mounted has its size.
    const id = requestAnimationFrame(() =>
      el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [index, steps, stopped, reduced]);
}
