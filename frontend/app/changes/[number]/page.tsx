"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useAulaLesson } from "@/components/aula";
import { RecordTag, TechDetails } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { StateBlock, WakeNotice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  EVALUATED_FIELDS,
  STATE_LABEL,
  TYPE_LABEL,
  markEvaluated,
  useChange,
  useRubric,
  type Change,
  type Evaluation,
  type FieldKey,
  type FieldScore,
  type Rubric,
} from "@/lib/changes";
import { absDate } from "@/lib/model";
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
  Verdict,
  type Motion,
} from "../evaluation";
import {
  buildSteps,
  fmtWeight,
  gatePassed,
  overallOf,
  reached,
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
                <Icons.replay />
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

  const scores = useMemo(() => {
    const map = new Map<FieldKey, FieldScore>();
    result?.fields.forEach((f) => map.set(f.key, f));
    return map;
  }, [result]);
  // While a re-evaluation runs, the ledger shows the current scores greyed out;
  // once it lands, the counters start from the scores before it.
  const currentScores = useMemo(
    () => new Map<FieldKey, number>(result?.fields.map((f) => [f.key, f.score]) ?? []),
    [result],
  );
  const previousScores = useMemo(
    () => new Map<FieldKey, number>(previous?.fields.map((f) => [f.key, f.score]) ?? []),
    [previous],
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
  const runId = `${runKey}-${replays}`;
  const playback: Playback = {
    index: lesson.done ? steps.length : lesson.step,
    done: lesson.done,
    skipped: skippedRun === runId,
    epoch: replays,
    skip: () => {
      setSkippedRun(runId);
      lesson.skip();
    },
    replay: () => {
      setReplays((n) => n + 1);
      lesson.replay();
    },
  };
  const showResult = phase !== "running" && result !== null && avg !== null;
  const at = (id: StepId) => showResult && reached(steps, playback.index, id);
  const gateClosed = at("portao") && result !== null && !gatePassed(result);

  const asideRef = useTallSticky();
  const inScope = result ? result.scope.in_scope : isInScope(change);
  const valueOf = (key: FieldKey) => edits[key] ?? change[key];

  async function evaluate() {
    setPhase("running");
    setErrMsg(null);
    try {
      const res = await api.evaluateChange(change.number, { fields: edits, model });
      setPrevious(result);
      setResult(res);
      // /changes marks the Changes evaluated in this session.
      markEvaluated(change.number, { overall: overallOf(res), passed: gatePassed(res) });
      setMotion(readMotion());
      setRunKey((k) => k + 1);
      setDirty(new Set());
      setPhase("done");
    } catch (error) {
      setErrMsg(error instanceof ApiError ? error.detail : "Erro inesperado.");
      setPhase("error");
    }
  }

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
  const epoch = `${runKey}-${playback.epoch}`;
  useFollowStep(steps, playback.index, epoch, motion.reduced, {
    aula: lesson.aula,
    gateClosed,
  });
  const notasStep = steps.find((s) => s.id === "notas");

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
          </span>
          <span className="badge chg-state">
            <span className="dot" />
            {STATE_LABEL[change.state] ?? change.state}
          </span>
          <span className="badge chg-risk">
            <span className="dot" />
            Risco {change.risk.toLowerCase()}
          </span>
        </div>
        <h1>{keepWhole(change.short_description)}</h1>
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
              Nota de 0 a 10 por campo. Quem aprova é uma pessoa.
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
                <button
                  className="btn btn-ai chg-go-btn"
                  onClick={evaluate}
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
                {phase === "running" && (
                  <RunningNote
                    seconds={elapsed}
                    fields={dirty.size > 0 && result ? dirty.size : orderedFields.length}
                  />
                )}
                {result && dirty.size > 0 && phase !== "running" && (
                  <p className="chg-hint">
                    {dirty.size === 1 ? "1 campo mudou" : `${dirty.size} campos mudaram`}.
                    Só {dirty.size === 1 ? "ele volta" : "eles voltam"} para a IA; os
                    outros são reaproveitados, porque o texto não mudou.
                  </p>
                )}
                {phase === "error" && errMsg && (
                  <p className="chg-error" role="alert">
                    <Icons.alert />
                    {errMsg}
                  </p>
                )}
              </>
            )}

            {showResult && overallOf(result) !== null && (
              <PlaybackBar
                steps={steps}
                playback={playback}
                seconds={result.duration_ms / 1000}
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
                  caption={showResult ? (notasStep?.caption ?? null) : null}
                />
              )}

            {showResult && overallOf(result) !== null && at("notas") && (
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
              />
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
            <Coherence
              key={`sem-${epoch}`}
              result={result}
              index={playback.index}
              steps={steps}
              skipped={playback.skipped}
              motion={motion}
            />
          )}

          {showResult && result.scope.in_scope && (gateClosed || at("problemas")) && (
            <Verdict key={`ver-${epoch}`} result={result} />
          )}
        </aside>

        <section className="chg-fields" aria-label="Campos avaliados">
          {orderedFields.map((f) => {
            const score = showResult ? scores.get(f.key) : undefined;
            const isDirty = dirty.has(f.key);
            const edited = edits[f.key] !== undefined;
            const i = order.get(f.key) ?? 0;
            const seg = avg?.segments.find((s) => s.key === f.key);
            const below =
              gateClosed && score !== undefined && score.score < result!.threshold;
            return (
              <article
                key={f.key}
                id={`campo-${f.key}`}
                className={`card chg-field${below ? " flag" : ""}`}
                style={{ "--i": i } as CSSProperties}
              >
                <header>
                  <div className="chg-field-title">
                    <h3>{f.label}</h3>
                    <span className="chg-weight">
                      peso {fmtWeight(seg?.weight ?? f.weight)}
                      {below && <span className="chg-below">abaixo do corte</span>}
                    </span>
                  </div>
                  {phase === "running" && inScope ? (
                    <span className="chg-score pending">Em avaliação</span>
                  ) : score && !isDirty ? (
                    <span className="chg-field-score" key={`sc-${epoch}`}>
                      {at("notas") && !score.reused && (
                        <DeltaChip delta={seg?.delta ?? null} />
                      )}
                      <FieldScoreChip
                        score={score.score}
                        from={previous?.fields.find((p) => p.key === f.key)?.score}
                        reused={score.reused}
                        run={at("notas")}
                        order={i}
                        skipped={playback.skipped}
                        motion={motion}
                      />
                    </span>
                  ) : null}
                </header>

                {editing === f.key ? (
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
                  <LongText text={valueOf(f.key)} />
                )}

                {score && !isDirty && editing !== f.key && (
                  <div className="chg-verdict" key={`v-${epoch}`} data-on={at("notas")}>
                    <p>{score.diagnosis}</p>
                    {score.guidance && (
                      <p className="chg-guidance">
                        <Icons.lightbulb />
                        {score.guidance}
                      </p>
                    )}
                  </div>
                )}

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
            <LongText text={change.backout_plan} />
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
