"use client";

// The incident suggestion pipeline, told honestly in two phases.
//
// 1. Rodando: the request is on the server. The seven steps sit in outline
//    with one indicator and the real elapsed seconds; no step pretends to be
//    "in progress", because the API answers everything at once.
// 2. Repassando o que a IA fez: when the answer is back, the steps reveal in
//    order with what each one decided (under 2 s, skippable; step by step in
//    modo aula). Step 4 opens into the three retrieval layers: tags, the
//    similarity ruler with the 0,80 floor, and the post-filter stamps.

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import { useAulaLesson } from "./aula";
import {
  ConceptIcon,
  ConceptLabel,
  GateMark as Gate,
  RecordTag,
  TechDetails,
} from "./concepts";
import { Icons, type IconComponent } from "./icons";
import { SuggestionMarkdown } from "./markdown";
import { CosineAngle, SimilarityRuler } from "./similarity-ruler";
import { buildSuggestionMarkdown } from "@/lib/model";
import { formatSeconds, useElapsedSeconds } from "@/lib/motion";
import {
  OUTCOME_LABEL,
  PIPELINE_STEPS,
  STEP_STATUS_LABEL,
  TAG_SOURCE_LABEL,
  beatsFor,
  citationSource,
  citationSummary,
  formatSim,
  layerShown,
  retrievalRows,
  stepReveal,
  stepViews,
  wordCount,
  type LessonStepKey,
  type Reveal,
  type RetrievalRow,
  type StepDef,
  type StepView,
} from "@/lib/pipeline";
import { funnel } from "@/lib/ruler";
import type { StepStatus, SuggestResponse } from "@/lib/types";

export type RunPhase = "idle" | "running" | "done" | "error";

type Style = CSSProperties & Record<`--${string}`, string | number>;

/** What the record itself says, for steps 1 and 2. */
export interface PipelineSource {
  description: string;
  category: string;
  subcategory: string;
  empresa: string;
  tags: string[];
}

export type CiteHandler = (n: string, el?: HTMLElement) => void;

const STATUS_ICON: Record<StepStatus, IconComponent> = {
  concluida: Icons.check,
  pulada: Icons.dot,
  degradada: Icons.alert,
};

/** The replay as a lesson: beats, captions and the current beat. */
export function usePipelineLesson(id: string, result: SuggestResponse | null) {
  const beats = useMemo(
    () => beatsFor(result?.dims, result?.retrieval.vector.min_similarity ?? 0.8),
    [result],
  );
  return useAulaLesson({ id, steps: beats, runKey: result });
}

export function PipelineTrace({
  phase,
  result,
  error,
  modelName,
  source,
  startedAt,
  durationMs,
  onRun,
  onCite,
  flashCite,
  onShowNotes,
}: {
  phase: RunPhase;
  result: SuggestResponse | null;
  error: string | null;
  modelName: string;
  source: PipelineSource;
  startedAt: number | null;
  durationMs: number | null;
  onRun: () => void;
  onCite: CiteHandler;
  flashCite: string | null;
  onShowNotes: () => void;
}) {
  const running = phase === "running";
  const shown = running ? null : result;
  const lesson = usePipelineLesson("pipeline", shown);
  const views = useMemo(() => (shown ? stepViews(shown) : null), [shown]);
  const beat = shown ? lesson.step : -1;
  const listRef = useRef<HTMLOListElement>(null);

  // In modo aula the step being explained comes into view on every move.
  useEffect(() => {
    if (!lesson.aula || beat < 0) return;
    const current = listRef.current?.querySelector<HTMLElement>(
      '.pipe-step[aria-current="step"]',
    );
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [beat, lesson.aula]);

  return (
    <div className="section pipe-section">
      <div className="pipe-head">
        <div className="pipe-head-text">
          <h2>Como a IA chegou na sugestão</h2>
          <p className="pipe-lede">Sete passos da máquina. No fim, quem decide é você.</p>
          <div className="pipe-legend" aria-label="Legenda">
            <ConceptLabel concept="ai-step">Passo da IA</ConceptLabel>
            <ConceptLabel concept="gate">Portão de sim ou não</ConceptLabel>
            <ConceptLabel concept="ai-out" />
            <ConceptLabel concept="human">Você decide</ConceptLabel>
          </div>
        </div>
        <button
          className={`btn ${result ? "btn-outline" : "btn-ai"}`}
          onClick={onRun}
          disabled={running}
        >
          {running ? (
            <Icons.loader className="spin" />
          ) : result ? (
            <Icons.replay />
          ) : (
            <Icons.aiSpark />
          )}
          {running ? "Analisando" : result ? "Analisar de novo" : "Analisar com a IA"}
        </button>
      </div>

      {phase === "error" ? (
        <div className="pipe-alert" role="alert">
          <Icons.alert />
          <div>
            <b>A análise não terminou.</b> {error}
          </div>
        </div>
      ) : null}

      <RunStatus
        running={running}
        startedAt={startedAt}
        durationMs={shown ? durationMs : null}
        replaying={Boolean(shown) && !lesson.done}
        aula={lesson.aula}
        onSkip={lesson.skip}
        onReplay={lesson.play}
      />

      <ol
        ref={listRef}
        className={`pipe${shown ? "" : " pipe-outline"}${running ? " is-running" : ""}`}
        aria-label="Etapas do pipeline"
        aria-busy={running}
      >
        {PIPELINE_STEPS.map((def) => {
          const view = views?.find((v) => v.key === def.key) ?? null;
          const reveal: Reveal = view ? stepReveal(def.key, beat) : "hidden";
          return (
            <StepItem
              key={def.key}
              def={def}
              view={reveal === "hidden" ? null : view}
              reveal={reveal}
              stopped={stoppedAfterGate(views, def.key, beat)}
            >
              {view && reveal !== "hidden" && shown ? (
                <StepDetail
                  step={def.key}
                  result={shown}
                  source={source}
                  beat={beat}
                  modelName={modelName}
                  onCite={onCite}
                  flashCite={flashCite}
                  onShowNotes={onShowNotes}
                />
              ) : null}
            </StepItem>
          );
        })}
      </ol>
    </div>
  );
}

/** Step 5 said IMPROCEDENTE (or no context): the rail stops at the gate. */
function stoppedAfterGate(
  views: StepView[] | null,
  key: LessonStepKey,
  beat: number,
): boolean {
  if (!views || key !== "classificar") return false;
  const sugerir = views.find((v) => v.key === "sugerir");
  return sugerir?.status === "pulada" && stepReveal("classificar", beat) !== "hidden";
}

/** One line on what is happening right now, with real time only. */
export function RunStatus({
  running,
  startedAt,
  durationMs,
  replaying,
  aula,
  onSkip,
  onReplay,
  compact = false,
}: {
  running: boolean;
  startedAt: number | null;
  durationMs: number | null;
  replaying: boolean;
  aula: boolean;
  onSkip: () => void;
  onReplay: () => void;
  compact?: boolean;
}) {
  const seconds = useElapsedSeconds(running ? startedAt : null);
  if (running) {
    return (
      <div className={`run-status is-running${compact ? " is-compact" : ""}`}>
        <Icons.loader className="spin" size={15} />
        <span role="status">A IA está analisando no servidor</span>
        <span className="run-clock mono" aria-hidden="true">
          {seconds} s
        </span>
      </div>
    );
  }
  if (durationMs == null) return null;
  return (
    <div className={`run-status${compact ? " is-compact" : ""}`}>
      <span className="run-replay">
        <Icons.replay size={14} />
        {replaying ? "Repassando o que a IA fez" : "O que a IA fez, etapa por etapa"}
      </span>
      <span className="run-took">
        resposta em <b className="mono">{formatSeconds(durationMs)}</b>
      </span>
      {replaying && !aula ? (
        <button type="button" className="btn btn-ghost btn-sm run-btn" onClick={onSkip}>
          Pular
        </button>
      ) : !replaying ? (
        <button type="button" className="btn btn-ghost btn-sm run-btn" onClick={onReplay}>
          <Icons.replay />
          Repassar
        </button>
      ) : null}
    </div>
  );
}

// Steps that already carry their own "Ver detalhes técnicos".
const OWN_DETAILS = new Set<LessonStepKey>(["numeros", "buscar", "classificar"]);

function StepItem({
  def,
  view,
  reveal,
  stopped,
  children,
}: {
  def: StepDef;
  view: StepView | null;
  reveal: Reveal;
  stopped: boolean;
  children: ReactNode;
}) {
  const Icon = view ? STATUS_ICON[view.status] : null;
  return (
    <li
      className={`pipe-step is-${reveal}${view ? ` st-${view.status}` : ""}${
        def.gate ? " is-gate" : ""
      }${stopped ? " is-stopped" : ""}`}
      aria-current={reveal === "current" ? "step" : undefined}
    >
      <span className="pipe-marker" aria-hidden="true">
        {def.gate ? <GateMark open={reveal !== "hidden" && !stopped} /> : null}
        <span className="pipe-marker-n">
          {reveal === "done" && view?.status === "concluida" && !def.gate ? (
            <Icons.check size={14} sw={2.8} />
          ) : (
            def.order
          )}
        </span>
      </span>
      <div className="pipe-body">
        <div className="pipe-title-row">
          <h3 className="pipe-title">
            <span className="sr-only">Etapa {def.order}: </span>
            {def.title}
          </h3>
          {view && Icon ? (
            <span className={`pipe-status st-${view.status}`}>
              <Icon size={12} sw={2.6} />
              {STEP_STATUS_LABEL[view.status]}
            </span>
          ) : null}
        </div>
        <p className={`pipe-decision${view ? "" : " is-hint"}`}>{def.hint}</p>
        {children}
        {view && view.decisions.length && !OWN_DETAILS.has(def.key) ? (
          <TechDetails summary="O que o servidor registrou">
            {view.decisions.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </TechDetails>
        ) : null}
      </div>
    </li>
  );
}

/** The procedência gate: a diamond whose halves part when it lets the run on. */
function GateMark({ open }: { open: boolean }) {
  return (
    <svg
      className={`gate${open ? " is-open" : ""}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path className="gate-l" d="M16 2 L2 16 L16 30 Z" />
      <path className="gate-r" d="M16 2 L30 16 L16 30 Z" />
    </svg>
  );
}

function StepDetail({
  step,
  result,
  source,
  beat,
  modelName,
  onCite,
  flashCite,
  onShowNotes,
}: {
  step: LessonStepKey;
  result: SuggestResponse;
  source: PipelineSource;
  beat: number;
  modelName: string;
  onCite: CiteHandler;
  flashCite: string | null;
  onShowNotes: () => void;
}) {
  switch (step) {
    case "carregar":
      return <LoadedFields source={source} />;
    case "resumir":
      return <Summary original={source.description} summary={result.summarized_query} />;
    case "numeros":
      return <Numbers result={result} />;
    case "buscar":
      return <Layers result={result} beat={beat} onCite={onCite} />;
    case "classificar":
      return (
        <div className="pipe-gate">
          <Gate
            rule="É falha técnica?"
            verdict={result.classification === "PROCEDENTE" ? "pass" : "fail"}
          />
          <p className="pipe-gate-why">
            {result.classification === "PROCEDENTE"
              ? "Procedente: segue para a sugestão."
              : "Improcedente: a IA para aqui."}
          </p>
          {result.decision.justification ? (
            <TechDetails summary="Por que a IA decidiu assim">
              <p>{result.decision.justification}</p>
            </TechDetails>
          ) : null}
        </div>
      );
    case "sugerir":
      return result.suggestion ? (
        <>
          <div className="suggestion pipe-suggestion">
            <div className="ai-out-head">
              <ConceptLabel concept="ai-out" />
              <span>Uma sugestão para revisar, não uma ordem.</span>
            </div>
            <SuggestionMarkdown
              source={buildSuggestionMarkdown(result.suggestion, result.context_ids)}
              onCite={onCite}
              flashCite={flashCite}
            />
            <div className="sugg-foot">
              Gerado por <b>{modelName}</b>.
            </div>
          </div>
          <CitedSources result={result} onCite={onCite} />
          <Citations result={result} />
        </>
      ) : null;
    case "publicar":
      return (
        <div className="pipe-human">
          <ConceptIcon concept="human" />
          <div>
            <b>Agora é com você.</b>
            <p>Confira as fontes e decida. A IA não resolve sozinha.</p>
            {result.publication.published ? (
              <button
                className="btn btn-primary btn-sm pipe-notes-btn"
                onClick={onShowNotes}
              >
                <Icons.list />
                Ver a nota no incidente
              </button>
            ) : null}
          </div>
        </div>
      );
  }
}

/** Step 1: the fields the analysis reads, as read from the record. */
function LoadedFields({ source }: { source: PipelineSource }) {
  const fields: [string, string][] = [
    ["Categoria", source.category],
    ["Subcategoria", source.subcategory],
    ["Empresa", source.empresa],
  ];
  return (
    <div className="pipe-block">
      <div className="pipe-label">O que a IA leu</div>
      <div className="pipe-chips loaded">
        {fields.map(([k, v], i) => (
          <span className="loaded-chip" key={k} style={{ "--i": i } as Style}>
            <span className="loaded-k">{k}</span> {v || "não informada"}
          </span>
        ))}
        {source.tags.map((t, i) => (
          <span className="tag loaded-chip" key={t} style={{ "--i": i + 3 } as Style}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Step 2: the long original next to the short summary that becomes the query. */
function Summary({ original, summary }: { original: string; summary: string }) {
  const before = wordCount(original);
  const after = wordCount(summary);
  return (
    <div className="pipe-block summary">
      <div className="summary-col summary-orig">
        <div className="pipe-label">
          Escrito pelo cliente <span className="mono">{before} palavras</span>
        </div>
        <p>{original}</p>
      </div>
      <Icons.arrowRight className="summary-arrow" />
      <div className="summary-col summary-new">
        <div className="pipe-label">
          Resumo da IA <span className="mono">{after} palavras</span>
        </div>
        <p>{summary}</p>
      </div>
    </div>
  );
}

/** Step 3: the summary becomes numbers; the raw text and values sit behind a tap. */
function Numbers({ result }: { result: SuggestResponse }) {
  const preview = result.embedding_preview ?? [];
  const dims = result.dims ?? 0;
  const peak = preview.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return (
    <div className="pipe-block">
      <div className="vec">
        <p className="vec-big">
          {dims ? (
            <>
              <b className="mono">{dims.toLocaleString("pt-BR")}</b> números
            </>
          ) : (
            <b>Uma lista longa de números</b>
          )}
          <span>que representam o sentido do resumo</span>
        </p>
        {preview.length ? (
          <div className="vec-bars" aria-hidden="true">
            {preview.map((v, i) => (
              <span
                key={i}
                className={`vec-bar ${v >= 0 ? "pos" : "neg"}`}
                style={{ "--h": Math.abs(v) / peak, "--i": i } as Style}
              />
            ))}
          </div>
        ) : null}
      </div>
      <TechDetails>
        <p>Texto que virou vetor (embedding):</p>
        <pre className="pipe-query">{result.query_text}</pre>
        {preview.length ? (
          <p className="vec-nums mono">
            [{preview.map(fmt).join("  ")}
            {dims > preview.length ? "  …" : ""}]
          </p>
        ) : (
          <p>Este servidor não devolve os valores do vetor; só o texto acima é real.</p>
        )}
      </TechDetails>
    </div>
  );
}

function Layers({
  result,
  beat,
  onCite,
}: {
  result: SuggestResponse;
  beat: number;
  onCite: CiteHandler;
}) {
  const { tags, vector, postfilter } = result.retrieval;
  const incidents = retrievalRows(result, "incidente");
  const problems = retrievalRows(result, "problema");
  const rows = [...incidents, ...problems];
  const f = funnel(result, rows);
  const reached = rows.filter((r) => r.outcome !== "abaixo");
  const showVector = layerShown("vetor", beat);
  const showCheck = layerShown("conferir", beat);
  const best = [...reached].sort((a, b) => b.sim - a.sim)[0] ?? null;

  return (
    <>
      <Funnel
        topK={f.topK}
        candidates={showVector ? f.candidates : null}
        passed={showVector ? f.passed : null}
        kept={showCheck ? f.kept : null}
        floor={vector.min_similarity}
      />
      <ol className="layers" aria-label="Camadas da busca">
        <li className="layer layer-in">
          <div className="layer-head">
            <span className="layer-n mono">1</span>
            <span className="layer-name">Onde procurar</span>
          </div>
          <p className="layer-line">
            {tags.filter_applied
              ? "As tags limitam a busca à parte certa do histórico."
              : "Sem tags reconhecidas: a busca olha o histórico inteiro."}
          </p>
          {tags.tags.length ? (
            <div className="pipe-chips">
              {tags.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          <TechDetails>
            <p>Camada 1, filtro por tags. As tags {TAG_SOURCE_LABEL[tags.source]}.</p>
            <p>{tags.decision}</p>
          </TechDetails>
        </li>

        {showVector ? (
          <li className="layer layer-in">
            <div className="layer-head">
              <span className="layer-n mono">2</span>
              <span className="layer-name">O quanto se parece</span>
            </div>
            <p className="layer-line">
              Nota de 0 a 1. Abaixo de {formatSim(vector.min_similarity)} fica de fora.
            </p>
            <SimilarityRuler
              incidents={incidents}
              problems={problems}
              floor={vector.min_similarity}
              onOpen={onCite}
            />
            <TechDetails>
              <p>
                Camada 2, busca vetorial por similaridade de cosseno. Limiar{" "}
                <b className="mono">{formatSim(vector.min_similarity)}</b>; até{" "}
                <b className="mono">{vector.incident_top_k}</b> incidentes e{" "}
                <b className="mono">{vector.problem_top_k}</b> problemas (top-K).
              </p>
              <p>{vector.decision}</p>
              {best ? <CosineAngle sim={best.sim} floor={vector.min_similarity} /> : null}
              <RowGroup
                title="Incidentes resolvidos"
                rows={incidents}
                stage="vector"
                onCite={onCite}
              />
              <RowGroup
                title="Problemas"
                rows={problems}
                stage="vector"
                onCite={onCite}
              />
            </TechDetails>
          </li>
        ) : null}

        {showCheck ? (
          <li className="layer layer-in">
            <div className="layer-head">
              <span className="layer-n mono">3</span>
              <span className="layer-name">Serve mesmo?</span>
            </div>
            <p className="layer-line">
              Parecer não basta. A IA descarta o que não ajuda.
            </p>
            {postfilter.status === "fallback" ? (
              <div className="pipe-alert is-warn">
                <Icons.alert />
                <div>
                  <b>Conferência indisponível</b> ({postfilter.fallback_reason}). A lista
                  original foi mantida: a precisão cai, mas o incidente não fica sem
                  resposta.
                </div>
              </div>
            ) : null}
            {reached.length ? (
              <RowGroup
                title={`${count(f.kept, "mantido", "mantidos")} e ${count(
                  f.passed - f.kept,
                  "descartado",
                  "descartados",
                )}`}
                rows={reached}
                stage="postfilter"
                cited={new Set(result.citations.cited)}
                onCite={onCite}
              />
            ) : (
              <div className="layer-empty">Nenhum candidato chegou a esta camada.</div>
            )}
            <div className="pipe-block">
              <div className="pipe-label">Casos que a IA vai usar para sugerir</div>
              {result.context_ids.length ? (
                <div className="pipe-chips">
                  {result.context_ids.map((id) => (
                    <IdChip key={id} id={id} onCite={onCite} />
                  ))}
                </div>
              ) : (
                <p className="layer-note">Nenhum caso passou pelas três camadas.</p>
              )}
            </div>
            <TechDetails>
              <p>Camada 3, pós-filtro por LLM. {postfilter.decision}</p>
            </TechDetails>
          </li>
        ) : null}
      </ol>
    </>
  );
}

/** "15 → 6 → 3": what each layer let through. Numbers appear with their layer. */
function Funnel({
  topK,
  candidates,
  passed,
  kept,
  floor,
}: {
  topK: number;
  candidates: number | null;
  passed: number | null;
  kept: number | null;
  floor: number;
}) {
  const stages: { n: number | null; label: string }[] = [
    { n: candidates, label: `achados (até ${topK})` },
    { n: passed, label: `de ${formatSim(floor)} para cima` },
    { n: kept, label: "aprovados" },
  ];
  return (
    <div className="funnel" aria-label="Funil das camadas">
      {stages.map((s, i) => (
        <div className={`funnel-stage${s.n == null ? " is-pending" : ""}`} key={i}>
          {i > 0 ? <Icons.arrowRight className="funnel-arrow" /> : null}
          <span className="funnel-n mono">{s.n ?? "?"}</span>
          <span className="funnel-l">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function RowGroup({
  title,
  rows,
  stage,
  cited,
  onCite,
}: {
  title: string;
  rows: RetrievalRow[];
  stage: "vector" | "postfilter";
  cited?: Set<string>;
  onCite: CiteHandler;
}) {
  if (!rows.length) {
    return <div className="layer-empty">{title}: nenhum resultado.</div>;
  }
  const renderRow = (r: RetrievalRow, i: number) => {
    const pill =
      stage === "vector"
        ? r.outcome === "abaixo"
          ? { cls: "drop", label: "pouco parecido" }
          : { cls: "keep", label: "passou" }
        : r.outcome === "descartado"
          ? { cls: "drop", label: OUTCOME_LABEL.descartado }
          : { cls: "keep", label: OUTCOME_LABEL[r.outcome] };
    return (
      <li
        key={`${stage}-${r.number}`}
        id={stage === "postfilter" ? `src-${r.number}` : undefined}
        className={`row${pill.cls === "drop" ? " is-dropped" : ""}${
          stage === "postfilter" ? " is-stamped" : ""
        }`}
        style={{ "--i": i } as Style}
      >
        <button
          type="button"
          className="row-num row-open"
          onClick={(e) => onCite(r.number, e.currentTarget)}
          aria-label={`Abrir ${r.number}: ${r.desc}`}
        >
          <RecordTag number={r.number} ghost={r.kind === "incidente"} size="sm" />
        </button>
        <span className="row-desc">{r.desc}</span>
        <span className="row-sim mono" title="Semelhança, de 0 a 1">
          {formatSim(r.sim)}
        </span>
        <span className={`row-pill ${pill.cls}`}>
          {pill.cls === "keep" ? (
            <Icons.check size={11} sw={3} />
          ) : (
            <Icons.close size={11} sw={3} />
          )}
          {pill.label}
        </span>
        {stage === "postfilter" && r.reason ? (
          <span className="row-reason">{r.reason}</span>
        ) : null}
        {cited?.has(r.number) ? (
          <span className="row-cited">
            <Icons.lightbulb size={12} />
            citado na sugestão
          </span>
        ) : null}
      </li>
    );
  };

  // After the check, the kept rows lead; the dropped ones (each with its
  // reason) fold away so a phone does not read as a wall of struck text.
  const fold = stage === "postfilter";
  const kept = fold ? rows.filter((r) => r.outcome !== "descartado") : rows;
  const dropped = fold ? rows.filter((r) => r.outcome === "descartado") : [];
  return (
    <div className="rows">
      <div className="rows-title">{title}</div>
      {kept.length ? <ul className="rows-list">{kept.map(renderRow)}</ul> : null}
      {dropped.length ? (
        <details className="rows-more">
          <summary>
            <Icons.chevronRight size={14} className="rows-more-chev" />
            {dropped.length === 1
              ? "Ver o descartado e o motivo"
              : `Ver os ${dropped.length} descartados e o motivo`}
          </summary>
          <ul className="rows-list">
            {dropped.map((r, i) => renderRow(r, kept.length + i))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Each source the suggestion cites, tied back to where it came from. */
function CitedSources({
  result,
  onCite,
}: {
  result: SuggestResponse;
  onCite: CiteHandler;
}) {
  const cited = result.citations.cited;
  if (!cited.length) return null;
  function show(id: string) {
    const row = document.getElementById(`src-${id}`);
    if (!row) return;
    // A folded (dropped) source opens before it scrolls into view.
    const fold = row.closest("details");
    if (fold) fold.open = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    row.classList.remove("is-flash");
    // Restart the one-shot highlight.
    void row.offsetWidth;
    row.classList.add("is-flash");
  }
  return (
    <div className="cited">
      <div className="pipe-label">De onde veio cada citação</div>
      <ul className="cited-list">
        {cited.map((id) => {
          const { row, inContext } = citationSource(id, result);
          return (
            <li key={id}>
              <IdChip id={id} onCite={onCite} />
              <span className="cited-what">
                {row
                  ? `${formatSim(row.sim)} · ${OUTCOME_LABEL[row.outcome]}`
                  : inContext
                    ? "entre os casos encontrados"
                    : "fora dos casos encontrados"}
              </span>
              {row ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => show(id)}
                >
                  Ver na busca
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Citations({ result }: { result: SuggestResponse }) {
  const { flagged } = result.citations;
  if (!flagged.length) {
    return (
      <TechDetails summary="Conferência das citações">
        <p>
          {citationSummary(flagged)} Citação que não veio da busca é removida ou marcada.
        </p>
      </TechDetails>
    );
  }
  return (
    <div className={`pipe-cites${flagged.length ? " has-flags" : ""}`}>
      <div className="pipe-cites-head">
        {flagged.length ? <Icons.alert size={14} /> : <Icons.checkCircle size={14} />}
        Validação das citações: {citationSummary(flagged)}
      </div>
      {flagged.length ? (
        <ul className="pipe-flags">
          {flagged.map((f) => (
            <li key={f.id}>
              <span
                className={`mono pipe-flag-id${f.action === "removida" ? " struck" : ""}`}
              >
                {f.id}
              </span>
              <span className="pipe-flag-what">
                {f.action === "removida"
                  ? "removida do texto: não estava no contexto recuperado"
                  : "mantida no texto e marcada: não estava no contexto recuperado"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function IdChip({ id, onCite }: { id: string; onCite: CiteHandler }) {
  const problem = id.startsWith("PRB");
  return (
    <button
      type="button"
      className="tag-btn"
      onClick={(e) => onCite(id, e.currentTarget)}
      aria-label={problem ? `Abrir problema ${id}` : `Abrir incidente ${id}`}
    >
      <RecordTag number={id} ghost={!problem} size="sm" />
    </button>
  );
}
