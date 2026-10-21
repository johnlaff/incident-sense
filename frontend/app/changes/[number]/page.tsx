"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useAulaLesson, useAulaStart } from "@/components/aula";
import { RecordTag, TechDetails } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { StateBlock, WakeNotice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  EVALUATED_FIELDS,
  STATE_LABEL,
  TYPE_HINT,
  TYPE_LABEL,
  isEvaluation,
  isScored,
  markEvaluated,
  plainTitle,
  readSavedEvaluation,
  saveEvaluation,
  stateHint,
  useChange,
  useRubric,
  type Change,
  type Evaluation,
  type FieldKey,
  type FieldScore,
  type Rubric,
} from "@/lib/changes";
import { absDate } from "@/lib/model";
import { scrollPos, showTop } from "@/lib/reveal";
import { DEFAULT_MODEL, MODELS, modelNameFromRoute } from "@/lib/models";

import "../changes.css";
import {
  Average,
  Coherence,
  DeltaChip,
  FieldScoreChip,
  Ledger,
  PlaybackBar,
  type Playback,
  RunningNote,
  STILL,
  readMotion,
  useElapsed,
  useFollowStep,
  Decision,
  type Motion,
} from "../evaluation";
import {
  buildSteps,
  decisionOf,
  firstSentence,
  rerunHint,
  sentFields,
  fmtWeight,
  gatePassed,
  overallOf,
  reached,
  verdictOf,
  weightedSegments,
  type StepId,
} from "../sequence";
import { keepWhole } from "@/lib/text";

type Phase = "idle" | "running" | "done" | "error";

export default function ChangeDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = use(params);
  const change = useChange(number);
  const rubric = useRubric();

  if (change.loading || rubric.loading) {
    return (
      <div className="chg-page" aria-busy="true">
        <WakeNotice show={change.slow || rubric.slow} />
        <div className="chg-detail-skel">
          <span className="sk" style={{ width: 120 }} />
          <span className="sk" style={{ width: "80%", height: 22 }} />
          <span className="sk" style={{ width: "60%" }} />
        </div>
      </div>
    );
  }
  if (change.errorStatus === 404) {
    return (
      <div className="chg-page">
        <nav className="crumbs" aria-label="Trilha">
          <Link href="/changes">Mudanças</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{number.toUpperCase()}</span>
        </nav>
        <StateBlock
          icon={Icons.search}
          title="Mudança não encontrada"
          action={
            <Link className="btn btn-outline" href="/changes">
              Voltar para mudanças
            </Link>
          }
        >
          Não existe mudança com o número {number.toUpperCase()}. Confira o número ou
          escolha uma na lista.
        </StateBlock>
      </div>
    );
  }
  if (change.error || !change.data || !rubric.data) {
    return (
      <div className="chg-page">
        <StateBlock
          variant="error"
          icon={Icons.alert}
          title="Não foi possível abrir a mudança"
          action={
            <div className="state-actions">
              <button
                className="btn btn-outline"
                onClick={() => {
                  change.retry();
                  rubric.retry();
                }}
              >
                <Icons.retry />
                Tentar de novo
              </button>
              <Link className="btn btn-ghost" href="/changes">
                Voltar para mudanças
              </Link>
            </div>
          }
        >
          {change.error ?? rubric.error ?? "Mudança não encontrada."}
        </StateBlock>
      </div>
    );
  }
  return <ChangeWorkspace change={change.data} rubric={rubric.data} />;
}

function ChangeWorkspace({ change, rubric }: { change: Change; rubric: Rubric }) {
  const [edits, setEdits] = useState<Partial<Record<FieldKey, string>>>({});
  const [editing, setEditing] = useState<FieldKey | null>(null);
  // With a result in, each field card folds to one line until opened.
  const [openFields, setOpenFields] = useState<Set<FieldKey>>(new Set());
  const toggleField = (key: FieldKey, on?: boolean) =>
    setOpenFields((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  // A link to "#campo-x" (the ledger rows) opens that card.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#campo-"]');
      if (!a) return;
      const key = a.getAttribute("href")!.slice("#campo-".length) as FieldKey;
      setOpenFields((prev) => new Set(prev).add(key));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Evaluation | null>(null);
  // The evaluation before the current one, for score deltas on re-evaluation.
  const [previous, setPrevious] = useState<Evaluation | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [motion, setMotion] = useState<Motion>(STILL);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Fields edited since the last evaluation: these are the ones the content
  // lock will send back to the model.
  const [dirty, setDirty] = useState<Set<FieldKey>>(new Set());
  const elapsed = useElapsed(phase === "running");
  // The model that read the current result: another one sends every field back.
  const [readWith, setReadWith] = useState<string | null>(null);
  // A result reopened from this tab (the list counts it as evaluated).
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    const saved = readSavedEvaluation(change);
    if (!saved) return;
    setEdits(saved.edits);
    if (MODELS.some((m) => m.id === saved.model)) setModel(saved.model);
    setReadWith(saved.model);
    setResult(saved.result);
    setSavedAt(saved.at);
    setPhase("done");
  }, [change]);

  const scores = useMemo(() => {
    const map = new Map<FieldKey, FieldScore>();
    result?.fields.forEach((f) => map.set(f.key, f));
    return map;
  }, [result]);
  // While a re-evaluation runs, the ledger shows the current scores greyed out;
  // once it lands, the counters start from the scores before it.
  const currentScores = useMemo(
    () =>
      new Map<FieldKey, number>(
        result?.fields.filter(isScored).map((f) => [f.key, f.score]) ?? [],
      ),
    [result],
  );
  const previousScores = useMemo(
    () =>
      new Map<FieldKey, number>(
        previous?.fields.filter(isScored).map((f) => [f.key, f.score]) ?? [],
      ),
    [previous],
  );
  const failedFields = useMemo(
    () => new Set<FieldKey>(result?.fields.filter((f) => !isScored(f)).map((f) => f.key)),
    [result],
  );

  const steps = useMemo(
    () => (result ? buildSteps(result, previous) : []),
    [result, previous],
  );
  const avg = useMemo(
    () =>
      result && result.fields.length > 0
        ? weightedSegments(result.fields, previous?.fields)
        : null,
    [result, previous],
  );
  const previousAvg = useMemo(
    () =>
      previous && previous.fields.length > 0 ? weightedSegments(previous.fields) : null,
    [previous],
  );
  // Modo aula drives the same steps: tap, arrows, Space or PageDown in aula;
  // outside it they play on their own at each step's length.
  const lessonSteps = useMemo(
    () => steps.map((s) => ({ title: s.title, caption: s.caption, durationMs: s.ms })),
    [steps],
  );
  const lesson = useAulaLesson({
    id: "mudanca-avaliacao",
    steps: lessonSteps,
    runKey: result ? runKey : null,
    // Reduced motion keeps the pacing; the steps crossfade instead of moving.
    reducedMotion: "pace",
  });
  const [replays, setReplays] = useState(0);
  const [skippedRun, setSkippedRun] = useState<string | null>(null);
  // Outside modo aula a result shows whole at once: no counting, no moving
  // bar, nothing scrolls. "Ver passo a passo" plays it on request.
  const [walkedRun, setWalkedRun] = useState<string | null>(null);
  const runId = `${runKey}-${replays}`;
  const instant = !lesson.aula && walkedRun !== runId;
  const { aula: inAula, done: lessonDone, skip: lessonSkip } = lesson;
  useEffect(() => {
    if (!inAula && !lessonDone && walkedRun !== runId) lessonSkip();
  }, [inAula, lessonDone, walkedRun, runId, lessonSkip]);
  // A new verdict: if the reader scrolled while it ran, leave them there; if
  // its top shows, nothing moves; below the fold, one scroll puts its top
  // under the top bar. Never later.
  const startPos = useRef<number | null>(null);
  useEffect(() => {
    if (phase === "running") startPos.current = scrollPos();
  }, [phase]);
  useEffect(() => {
    if (inAula || runKey === 0) return;
    const moved =
      startPos.current !== null && Math.abs(scrollPos() - startPos.current) > 80;
    startPos.current = null;
    if (moved) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(".chg-banner");
      if (el) showTop(el, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    return () => cancelAnimationFrame(raf);
  }, [runKey, inAula]);
  const playback: Playback = {
    index: lesson.done || instant ? steps.length : lesson.step,
    done: lesson.done || instant,
    skipped: skippedRun === runId || instant,
    epoch: replays,
    skip: () => {
      setSkippedRun(runId);
      lesson.skip();
    },
    replay: () => {
      setWalkedRun(`${runKey}-${replays + 1}`);
      setReplays((n) => n + 1);
      lesson.replay();
    },
  };
  const showResult = phase !== "running" && result !== null && avg !== null;
  const at = (id: StepId) => showResult && reached(steps, playback.index, id);
  const gateClosed = at("portao") && result !== null && !gatePassed(result);
  // Modo aula ends on the verdict, whatever the last step is (P1-N2).
  const atLast = showResult && steps.length > 0 && playback.index >= steps.length - 1;

  const asideRef = useTallSticky();
  const inScope = result ? result.scope.in_scope : isInScope(change);
  const rerun = {
    dirty: dirty.size,
    modelChanged: result !== null && readWith !== null && readWith !== model,
    total: EVALUATED_FIELDS.length,
  };
  // Edited since the result: the verdict and the numbers are the old text's.
  const stale = result !== null && dirty.size > 0 && phase !== "running";
  const valueOf = (key: FieldKey) => edits[key] ?? change[key];

  // The header's "Modo aula" plays the verdict step by step, or runs the
  // evaluation when there is none yet. Nothing while one runs: a second
  // request would spend the quota twice (P2-N6).
  useAulaStart(
    "mudanca",
    phase === "running"
      ? null
      : result
        ? playback.replay
        : inScope
          ? () => void evaluate()
          : null,
  );
  // The run in flight skips the content lock ("Avaliar de novo").
  const [freshRun, setFreshRun] = useState(false);

  async function evaluate(fresh = false) {
    setPhase("running");
    setFreshRun(fresh);
    setErrMsg(null);
    try {
      const res = await api.evaluateChange(change.number, {
        fields: edits,
        model,
        ...(fresh ? { fresh: true } : {}),
      });
      if (!isEvaluation(res)) {
        setErrMsg("A avaliação voltou incompleta. Tente de novo.");
        setPhase("error");
        return;
      }
      setPrevious(result);
      setResult(res);
      setReadWith(model);
      setSavedAt(null);
      // /changes marks the Changes evaluated in this session, and the page
      // reopens this result while the text stays the same.
      const edited = Object.keys(edits).length > 0;
      markEvaluated(change.number, {
        overall: overallOf(res),
        passed: gatePassed(res),
        ok: decisionOf(res)?.ok ?? false,
        title: verdictOf(res)?.title,
        edited,
      });
      saveEvaluation(change, { edits, model, result: res, at: Date.now() });
      setMotion(readMotion());
      setRunKey((k) => k + 1);
      setDirty(new Set());
      setPhase("done");
    } catch (error) {
      setErrMsg(
        error instanceof ApiError ? error.detail : "Não foi possível avaliar agora.",
      );
      setPhase("error");
    }
  }
  // On a phone the button can sit near the bottom bar: bring the error up.
  const errRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (phase !== "error") return;
    const el = errRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bottomBar =
      document.querySelector(".tabbar")?.getBoundingClientRect().height ?? 0;
    if (r.top < 64 || r.bottom > window.innerHeight - bottomBar - 8)
      el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [phase, errMsg]);

  function startEdit(key: FieldKey) {
    setEditing(key);
    setDraft(valueOf(key));
  }

  function saveEdit(key: FieldKey) {
    const next = draft;
    setEdits((prev) => {
      const copy = { ...prev };
      if (next === change[key]) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    if (next !== valueOf(key)) setDirty((prev) => new Set(prev).add(key));
    setEditing(null);
  }

  const orderedFields = rubric.fields.filter((f) =>
    (EVALUATED_FIELDS as readonly string[]).includes(f.key),
  );
  const order = new Map(orderedFields.map((f, i) => [f.key, i]));
  const totalWeight = orderedFields.reduce((sum, f) => sum + f.weight, 0);
  const epoch = `${runKey}-${playback.epoch}`;
  useFollowStep(steps, playback.index, epoch, motion.reduced, {
    aula: lesson.aula,
    gateClosed,
  });
  const notasStep = steps.find((s) => s.id === "notas");
  // The header reads the same verdict as the banner (E2E P0-2).
  const headerHint = stateHint(
    change.state,
    result && !stale && phase !== "running" ? (verdictOf(result)?.title ?? null) : null,
  );
  // Everything came back from the lock in this tab's first result: say so,
  // and offer a reading that skips it (P1-N4).
  const allReused =
    result !== null &&
    result.fields.length > 0 &&
    result.fields.every((f) => f.reused) &&
    previous === null;
  const whyByField = useMemo(
    () =>
      new Map<FieldKey, string>(
        result?.fields.map((f) => [f.key, firstSentence(f.diagnosis)]) ?? [],
      ),
    [result],
  );

  return (
    <div className="chg-page">
      <nav className="crumbs" aria-label="Trilha">
        <Link href="/changes">Mudanças</Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{change.number}</span>
      </nav>

      <header className="chg-record-head">
        <div className="chg-band">
          <RecordTag number={change.number} size="lg" />
        </div>
        <div className="chg-tags">
          <span className="badge chg-type">
            <span className="dot" />
            {TYPE_LABEL[change.type] ?? change.type}
            {TYPE_HINT[change.type] ? `: ${TYPE_HINT[change.type]}` : ""}
          </span>
          <span className="badge chg-state">
            <span className="dot" />
            {STATE_LABEL[change.state] ?? change.state}
            {headerHint ? `: ${headerHint}` : ""}
          </span>
          <span className="badge chg-risk">
            <span className="dot" />
            Risco {change.risk.toLowerCase()}
          </span>
        </div>
        <TitleLines
          technical={change.short_description}
          plain={change.plain_summary?.short_description}
        />
        <dl className="chg-facts">
          <div>
            <dt>Serviço</dt>
            <dd>{keepWhole(change.cmdb_ci)}</dd>
          </div>
          <div className="wide">
            <dt>Grupo responsável</dt>
            <dd>{keepWhole(change.assignment_group)}</dd>
          </div>
          <div className="wide">
            <dt>Janela de execução</dt>
            <dd>
              {/* Each date stays whole; the line breaks only at "até". */}
              <span className="meta-item">{absDate(change.planned_start)}</span> até{" "}
              <span className="meta-item">{absDate(change.planned_end)}</span>
            </dd>
          </div>
          <div>
            <dt>Empresa</dt>
            <dd>{change.company}</dd>
          </div>
        </dl>
      </header>

      <div className="chg-grid" data-skip={playback.skipped}>
        <aside className="chg-aside" ref={asideRef}>
          <section className="card chg-run" aria-labelledby="run-h">
            <h2 id="run-h">Nota da IA para este pedido</h2>
            <p className="chg-run-lede">
              A IA dá nota a cada parte do pedido e diz se pode seguir. Quem aprova é uma
              pessoa.
            </p>
            {!inScope ? (
              <p className="chg-out-note">
                <Icons.alert />
                <span>
                  {result?.scope.reason ?? outOfScopeReason(change)} Sem nota não é nota
                  baixa.
                </span>
              </p>
            ) : (
              <>
                {savedAt !== null && phase === "done" && (
                  <p className="chg-saved">
                    Avaliada em <span className="num">{savedTime(savedAt)}</span>, nesta
                    aba. O resultado abaixo é dessa avaliação.
                  </p>
                )}
                <button
                  className="btn btn-ai chg-go-btn"
                  onClick={() => void evaluate()}
                  disabled={phase === "running"}
                >
                  {phase === "running" ? (
                    <>
                      <Icons.loader className="spin" />
                      Avaliando
                    </>
                  ) : (
                    <>
                      <Icons.aiSpark />
                      {result ? "Reavaliar" : "Avaliar com a IA"}
                    </>
                  )}
                </button>
                <TechDetails summary="Detalhes técnicos">
                  <label className="chg-model">
                    <span>Modelo de IA</span>
                    <select
                      className="select"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={phase === "running"}
                    >
                      {MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </TechDetails>
                {result && phase !== "running" && (
                  <div className="chg-fresh">
                    {allReused && (
                      <p className="chg-hint">
                        Este navegador já tinha avaliado este texto: as notas foram
                        reaproveitadas, sem chamar a IA.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void evaluate(true)}
                    >
                      <Icons.retry />
                      Avaliar de novo, sem reaproveitar
                    </button>
                  </div>
                )}
                {phase === "running" && (
                  <RunningNote
                    seconds={elapsed}
                    fields={
                      freshRun
                        ? EVALUATED_FIELDS.length
                        : sentFields({ ...rerun, first: !result })
                    }
                    mayReuse={!result && !freshRun}
                  />
                )}
                {result && phase !== "running" && rerunHint(rerun) && (
                  <p className="chg-hint">{rerunHint(rerun)}</p>
                )}
                {phase === "error" && errMsg && (
                  <p className="chg-error" role="alert" ref={errRef}>
                    <Icons.alert />
                    {errMsg}
                  </p>
                )}
              </>
            )}

            {/* The answer before the numbers; modo aula keeps it for the end. */}
            {stale && (
              <p className="chg-stale-note" role="status">
                <Icons.alert />
                <span>Resultado do texto anterior. Reavalie para ver a nota nova.</span>
              </p>
            )}
            {showResult && inScope && !lesson.aula && (
              <div className="chg-stale-wrap" data-stale={stale}>
                <Decision result={result} />
              </div>
            )}

            {showResult && overallOf(result) !== null && (
              <PlaybackBar
                steps={steps}
                playback={playback}
                seconds={result.duration_ms / 1000}
                instant={!lesson.aula}
              />
            )}

            {inScope &&
              (phase === "running" || (showResult && overallOf(result) !== null)) && (
                <Ledger
                  key={`led-${epoch}`}
                  rows={orderedFields}
                  avg={showResult ? avg : null}
                  previous={phase === "running" ? currentScores : previousScores}
                  run={at("notas")}
                  skipped={playback.skipped}
                  motion={motion}
                  flagBelow={gateClosed}
                  threshold={result?.threshold ?? rubric.eligibility_threshold}
                  caption={
                    showResult && lesson.aula ? (notasStep?.caption ?? null) : null
                  }
                  why={showResult && !lesson.aula ? whyByField : null}
                  pending={stale ? dirty : null}
                  failed={showResult ? failedFields : null}
                />
              )}

            {showResult && overallOf(result) !== null && at("notas") && (
              <div className="chg-stale-wrap" data-stale={stale}>
                <Average
                  key={`avg-${epoch}`}
                  result={result}
                  avg={avg}
                  previousAvg={previousAvg}
                  previousOverall={previous ? overallOf(previous) : null}
                  index={playback.index}
                  steps={steps}
                  skipped={playback.skipped}
                  motion={motion}
                  aula={lesson.aula}
                />
              </div>
            )}

            {showResult && overallOf(result) !== null && (
              <TechDetails summary="Custo e versão dos critérios">
                <p className="chg-cost" data-on={at("portao")}>
                  {result.model_calls === 0
                    ? "Nenhuma chamada à IA"
                    : `${result.model_calls} ${result.model_calls === 1 ? "chamada" : "chamadas"} à IA`}
                  {reusedCount(result) > 0 &&
                    ` · ${reusedCount(result)} ${reusedCount(result) === 1 ? "nota reaproveitada" : "notas reaproveitadas"}`}
                  {" · "}
                  {modelNameFromRoute(result.model)}
                  <br />
                  Critérios versão {result.rubric_version}
                </p>
              </TechDetails>
            )}
          </section>

          {showResult && result.scope.in_scope && at("portao") && (
            <div className="chg-stale-wrap" data-stale={stale}>
              <Coherence
                key={`sem-${epoch}`}
                result={result}
                change={change}
                index={playback.index}
                steps={steps}
                skipped={playback.skipped}
                motion={motion}
              />
            </div>
          )}

          {showResult &&
            lesson.aula &&
            result.scope.in_scope &&
            (gateClosed || atLast) && (
              <div className="chg-stale-wrap" data-stale={stale}>
                <Decision key={`ver-${epoch}`} result={result} closing />
              </div>
            )}
        </aside>

        <section className="chg-fields" aria-label="Campos avaliados">
          <p className="chg-weight-note">
            <b>Peso</b> é quanto cada parte conta na nota final. Os pesos somam{" "}
            <span className="num">{fmtWeight(totalWeight)}</span>.
          </p>
          {orderedFields.map((f) => {
            const score = showResult ? scores.get(f.key) : undefined;
            const isDirty = dirty.has(f.key);
            const edited = edits[f.key] !== undefined;
            const i = order.get(f.key) ?? 0;
            const seg = avg?.segments.find((s) => s.key === f.key);
            const below =
              gateClosed &&
              score !== undefined &&
              score.score !== null &&
              score.score < result!.threshold;
            const foldable =
              score !== undefined && !isDirty && editing !== f.key && phase !== "running";
            const folded = foldable && !openFields.has(f.key);
            const plain = !edited ? change.plain_summary?.[f.key] : undefined;
            return (
              <article
                key={f.key}
                id={`campo-${f.key}`}
                className={`card chg-field${below ? " flag" : ""}${foldable ? " foldable" : ""}`}
                data-folded={folded}
                style={{ "--i": i } as CSSProperties}
              >
                <header>
                  <div className="chg-field-title">
                    <h3>
                      {foldable ? (
                        <button
                          type="button"
                          className="chg-field-toggle"
                          aria-expanded={!folded}
                          onClick={() => toggleField(f.key)}
                        >
                          {f.label}
                          <Icons.chevronDown className="chg-field-chev" />
                        </button>
                      ) : (
                        f.label
                      )}
                    </h3>
                    <span className="chg-weight">
                      peso {fmtWeight(seg?.weight ?? f.weight)} de{" "}
                      {fmtWeight(totalWeight)}
                      {below && <span className="chg-below">abaixo do corte</span>}
                    </span>
                  </div>
                  {phase === "running" && inScope ? (
                    <span className="chg-score pending">Em avaliação</span>
                  ) : score && !isDirty && score.score === null ? (
                    <span className="chg-score empty failed">sem nota</span>
                  ) : score && !isDirty && score.score !== null ? (
                    <span className="chg-field-score" key={`sc-${epoch}`}>
                      {at("notas") && !score.reused && (
                        <DeltaChip delta={seg?.delta ?? null} />
                      )}
                      <FieldScoreChip
                        score={score.score}
                        from={
                          previous?.fields.find((p) => p.key === f.key)?.score ??
                          undefined
                        }
                        reused={score.reused}
                        run={at("notas")}
                        order={i}
                        skipped={playback.skipped}
                        motion={motion}
                      />
                    </span>
                  ) : null}
                </header>

                {folded ? (
                  <p className="chg-field-why">{firstSentence(score.diagnosis)}</p>
                ) : editing === f.key ? (
                  <div className="chg-edit">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
                      aria-label={`Editar ${f.label}`}
                      autoFocus
                    />
                    <div className="chg-edit-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveEdit(f.key)}
                      >
                        Salvar texto
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* The plain sentence is about the original text: an
                        edited field drops it, and then the text itself leads. */}
                    {plain ? (
                      <>
                        <p className="plain-summary chg-plain">
                          <b>Em resumo:</b> {plain}
                        </p>
                        <TechText text={valueOf(f.key)} />
                      </>
                    ) : (
                      <LongText text={valueOf(f.key)} />
                    )}
                  </>
                )}

                {!folded && score && !isDirty && editing !== f.key && (
                  <div className="chg-verdict" key={`v-${epoch}`} data-on={at("notas")}>
                    <p>{score.diagnosis}</p>
                    {score.guidance && (
                      <p className="chg-guidance">
                        <Icons.lightbulb />
                        <span>
                          {(score.score ?? 0) < (result?.threshold ?? 8) && (
                            <b>O que subiria a nota: </b>
                          )}
                          {score.guidance}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {!folded && (
                  <footer>
                    {score && !isDirty && score.reused && (
                      <span
                        className="chg-lock"
                        title="O texto não mudou, então a nota foi reaproveitada sem chamar a IA"
                      >
                        <Icons.check sw={3} />
                        Reaproveitado: o texto não mudou
                      </span>
                    )}
                    {isDirty && (
                      <span className="chg-lock dirty">Editado: será reavaliado</span>
                    )}
                    {!isDirty && edited && !score && phase !== "running" && (
                      <span className="chg-lock dirty">Editado</span>
                    )}
                    {inScope && editing !== f.key && phase !== "running" && (
                      <button
                        className="btn btn-outline btn-sm chg-edit-btn"
                        onClick={() => startEdit(f.key)}
                      >
                        Editar campo
                      </button>
                    )}
                  </footer>
                )}
              </article>
            );
          })}

          <article className="card chg-field chg-backout">
            <header>
              <div className="chg-field-title">
                <h3>Plano de retorno</h3>
                <span className="chg-weight">entra só na conferência de coerência</span>
              </div>
            </header>
            {change.plain_summary?.backout_plan ? (
              <>
                <p className="plain-summary chg-plain">
                  <b>Em resumo:</b> {change.plain_summary.backout_plan}
                </p>
                <TechText text={change.backout_plan} />
              </>
            ) : (
              <LongText text={change.backout_plan} />
            )}
            <h4>Tarefas cadastradas</h4>
            <ol className="chg-tasks">
              {change.tasks.map((t) => (
                <li key={t.number}>
                  <span className="mono">{t.number}</span>
                  <span>{keepWhole(t.short_description)}</span>
                </li>
              ))}
            </ol>
          </article>
        </section>
      </div>
    </div>
  );
}

/** The plain title leads; the record's own title is one tap away. */
function TitleLines({ technical, plain }: { technical: string; plain?: string }) {
  const [open, setOpen] = useState(false);
  const lead = plainTitle(plain);
  if (!lead) return <h1>{keepWhole(technical)}</h1>;
  return (
    <>
      <h1>{lead}</h1>
      <div className="chg-tech-title">
        <button
          type="button"
          className="chg-tech-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Esconder o texto técnico" : "Ler o texto técnico"}
        </button>
        {open && <p>{keepWhole(technical)}</p>}
      </div>
    </>
  );
}

/** The field's own words, behind one link once a plain line leads. */
function TechText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chg-tech-title">
      <button
        type="button"
        className="chg-tech-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Esconder o texto técnico" : "Ler o texto técnico"}
      </button>
      {open && <p className="chg-text">{text}</p>}
    </div>
  );
}

/** A field's text, folded to a few lines on a phone until the reader opens it. */
function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div className="chg-text-wrap" data-long={long} data-open={open}>
      <p className="chg-text">{text}</p>
      {long ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm chg-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Mostrar menos" : "Ler tudo"}
        </button>
      ) : null}
    </div>
  );
}

function reusedCount(result: Evaluation): number {
  return result.fields.filter((f) => f.reused).length;
}

function isInScope(change: Change): boolean {
  return (
    change.type === "Normal" &&
    change.state === "New" &&
    change.company === "Banco Meridiano"
  );
}

function outOfScopeReason(change: Change): string {
  const reasons: string[] = [];
  if (change.type !== "Normal")
    reasons.push(`é do tipo ${TYPE_LABEL[change.type] ?? change.type}`);
  if (change.state !== "New")
    reasons.push(`está ${(STATE_LABEL[change.state] ?? change.state).toLowerCase()}`);
  if (change.company !== "Banco Meridiano") reasons.push(`é da ${change.company}`);
  return `Não avaliada: só entram mudanças do tipo normal, novas e do Banco Meridiano, e esta ${reasons.join(" e ")}.`;
}

/** A sticky panel taller than its scroller sticks by its end, not its top. */
function useTallSticky() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>(".main");
    if (!el || !scroller) return;
    const root = document.documentElement;
    const fit = () => {
      // In modo aula its end stops above the caption strip, not behind it.
      const bar = root.hasAttribute("data-aula-bar")
        ? parseFloat(getComputedStyle(root).getPropertyValue("--aula-bar-h")) || 0
        : 0;
      const room = scroller.clientHeight - el.offsetHeight - 24 - (bar ? bar + 24 : 0);
      el.style.setProperty("--aside-top", `${Math.min(0, room)}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(scroller);
    // The strip comes and goes with modo aula and changes height per caption.
    const mo = new MutationObserver(fit);
    mo.observe(root, { attributes: true, attributeFilter: ["style", "data-aula-bar"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}

/** "21/10 às 14:32", for a result reopened in the same tab. */
function savedTime(at: number): string {
  const d = new Date(at);
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}
