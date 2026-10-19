"use client";

// The incident suggestion pipeline, step by step: the seven steps of the
// article plus the procedência gate, each with what it decided. Step 4 opens
// into the three retrieval layers with every candidate kept or dropped.

import type { ReactNode } from "react";

import { Icons, type IconComponent } from "./icons";
import { SuggestionMarkdown } from "./markdown";
import { activate } from "@/lib/a11y";
import { buildSuggestionMarkdown } from "@/lib/model";
import {
  OUTCOME_LABEL,
  STEP_OUTLINE,
  STEP_STATUS_LABEL,
  TAG_SOURCE_LABEL,
  citationSummary,
  formatSim,
  layerCounts,
  orderedSteps,
  retrievalRows,
  stepMarker,
  type RetrievalRow,
} from "@/lib/pipeline";
import type { PipelineStep, StepStatus, SuggestResponse } from "@/lib/types";

export type RunPhase = "idle" | "running" | "done" | "error";

const STATUS_ICON: Record<StepStatus, IconComponent> = {
  concluida: Icons.check,
  pulada: Icons.dot,
  degradada: Icons.alert,
};

export function PipelineTrace({
  phase,
  result,
  error,
  modelName,
  onRun,
  onCite,
  flashCite,
  onShowNotes,
}: {
  phase: RunPhase;
  result: SuggestResponse | null;
  error: string | null;
  modelName: string;
  onRun: () => void;
  onCite: (n: string) => void;
  flashCite: string | null;
  onShowNotes: () => void;
}) {
  const running = phase === "running";
  return (
    <div className="section pipe-section">
      <div className="pipe-head">
        <div className="pipe-head-text">
          <h2>Pipeline de sugestão</h2>
          <p className="pipe-lede">
            As sete etapas da análise e o que cada uma decidiu, com as fontes para você
            conferir.
          </p>
        </div>
        <button
          className={`btn btn-sm ${result ? "btn-outline" : "btn-primary"}`}
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
          {running ? "Analisando" : result ? "Analisar de novo" : "Analisar incidente"}
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

      {result && phase !== "running" ? (
        <ol className="pipe" aria-label="Etapas do pipeline">
          {orderedSteps(result).map((step, i) => (
            <StepItem key={step.id} step={step} index={i}>
              <StepDetail
                step={step}
                result={result}
                modelName={modelName}
                onCite={onCite}
                flashCite={flashCite}
                onShowNotes={onShowNotes}
              />
            </StepItem>
          ))}
        </ol>
      ) : (
        <ol
          className={`pipe pipe-outline${running ? " is-running" : ""}`}
          aria-label="Etapas do pipeline"
          aria-busy={running}
        >
          {STEP_OUTLINE.map((s) => (
            <li key={s.id} className={`pipe-step${s.gate ? " is-gate" : ""}`}>
              <span className="pipe-marker" aria-hidden>
                <span>
                  {running ? <Icons.loader className="spin" /> : s.gate ? "?" : s.order}
                </span>
              </span>
              <div className="pipe-body">
                <div className="pipe-title">
                  <span className="sr-only">
                    {s.gate ? "Decisão" : `Etapa ${s.order}`}:{" "}
                  </span>
                  {s.title}
                </div>
                <p className="pipe-decision is-hint">{s.hint}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StepItem({
  step,
  index,
  children,
}: {
  step: PipelineStep;
  index: number;
  children: ReactNode;
}) {
  const Icon = STATUS_ICON[step.status];
  return (
    <li
      className={`pipe-step st-${step.status}${step.gate ? " is-gate" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="pipe-marker" aria-hidden>
        <span>{stepMarker(step)}</span>
      </span>
      <div className="pipe-body">
        <div className="pipe-title-row">
          <h3 className="pipe-title">
            <span className="sr-only">
              {step.gate ? "Decisão" : `Etapa ${step.order}`}:{" "}
            </span>
            {step.title}
          </h3>
          <span className={`pipe-status st-${step.status}`}>
            <Icon size={12} sw={2.6} />
            {STEP_STATUS_LABEL[step.status]}
          </span>
        </div>
        <p className="pipe-decision">{step.decision}</p>
        {children}
      </div>
    </li>
  );
}

function StepDetail({
  step,
  result,
  modelName,
  onCite,
  flashCite,
  onShowNotes,
}: {
  step: PipelineStep;
  result: SuggestResponse;
  modelName: string;
  onCite: (n: string) => void;
  flashCite: string | null;
  onShowNotes: () => void;
}) {
  switch (step.id) {
    case "embedding":
      return (
        <div className="pipe-block">
          <div className="pipe-label">Texto vetorizado</div>
          <pre className="pipe-query">{result.query_text}</pre>
        </div>
      );
    case "recuperar":
      return <Layers result={result} onCite={onCite} />;
    case "contexto":
      return result.context_ids.length ? (
        <div className="pipe-chips">
          {result.context_ids.map((id) => (
            <IdChip key={id} id={id} onCite={onCite} />
          ))}
        </div>
      ) : null;
    case "decidir":
      return (
        <div
          className={`pipe-verdict ${result.classification === "PROCEDENTE" ? "ok" : "bad"}`}
        >
          {result.classification === "PROCEDENTE" ? (
            <Icons.checkCircle />
          ) : (
            <Icons.alert />
          )}
          {result.classification === "PROCEDENTE" ? "Procedente" : "Improcedente"}
          <span className="pipe-verdict-sub">
            {result.decision.generates_suggestion ? "gera sugestão" : "não gera sugestão"}
          </span>
        </div>
      );
    case "sugerir":
      return result.suggestion ? (
        <>
          <div className="suggestion pipe-suggestion">
            <SuggestionMarkdown
              source={buildSuggestionMarkdown(result.suggestion, result.context_ids)}
              onCite={onCite}
              flashCite={flashCite}
            />
            <div className="sugg-foot">
              Gerado por <b>{modelName}</b>.
            </div>
          </div>
          <Citations result={result} />
        </>
      ) : null;
    case "publicar":
      return result.publication.published ? (
        <button className="btn btn-outline btn-sm pipe-notes-btn" onClick={onShowNotes}>
          <Icons.list />
          Ver nas notas de trabalho
        </button>
      ) : null;
    default:
      return null;
  }
}

function Citations({ result }: { result: SuggestResponse }) {
  const { flagged } = result.citations;
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
                  ? "removida do texto: não está no contexto recuperado"
                  : "mantida no texto e marcada: não está no contexto recuperado"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Layers({
  result,
  onCite,
}: {
  result: SuggestResponse;
  onCite: (n: string) => void;
}) {
  const { tags, vector, postfilter } = result.retrieval;
  const incidents = retrievalRows(result, "incidente");
  const problems = retrievalRows(result, "problema");
  const inc = layerCounts(incidents);
  const prb = layerCounts(problems);
  const reached = [...incidents, ...problems].filter((r) => r.outcome !== "abaixo");
  return (
    <ol className="layers" aria-label="Camadas da recuperação">
      <li className="layer">
        <div className="layer-head">
          <Icons.filter size={15} />
          <span className="layer-name">Camada 1 · Tags semânticas</span>
          <span className="layer-what">decidem onde procurar</span>
        </div>
        <p className="layer-decision">{tags.decision}</p>
        {tags.tags.length ? (
          <div className="pipe-chips">
            {tags.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
            <span className="layer-note">{TAG_SOURCE_LABEL[tags.source]}</span>
          </div>
        ) : null}
      </li>

      <li className="layer">
        <div className="layer-head">
          <Icons.vectorSearch size={15} />
          <span className="layer-name">Camada 2 · Vetor</span>
          <span className="layer-what">mede o que parece</span>
        </div>
        <p className="layer-decision">{vector.decision}</p>
        <div className="layer-params">
          <span>
            cosseno mínimo <b className="mono">{formatSim(vector.min_similarity)}</b>
          </span>
          <span>
            top-K incidentes <b className="mono">{vector.incident_top_k}</b>
          </span>
          <span>
            top-K problemas <b className="mono">{vector.problem_top_k}</b>
          </span>
        </div>
        <RowGroup
          title={`Incidentes resolvidos · ${inc.passed} de ${inc.total} passaram`}
          rows={incidents}
          stage="vector"
          onCite={onCite}
        />
        <RowGroup
          title={`Problemas · ${prb.passed} de ${prb.total} passaram`}
          rows={problems}
          stage="vector"
          onCite={onCite}
        />
      </li>

      <li className="layer">
        <div className="layer-head">
          <Icons.funnel size={15} />
          <span className="layer-name">Camada 3 · Pós-filtro por LLM</span>
          <span className="layer-what">decide o que serve</span>
        </div>
        <p className="layer-decision">{postfilter.decision}</p>
        {postfilter.status === "fallback" ? (
          <div className="pipe-alert is-warn">
            <Icons.alert />
            <div>
              <b>Pós-filtro indisponível</b> ({postfilter.fallback_reason}). A lista
              original foi mantida: a precisão cai, mas o incidente não fica sem resposta.
            </div>
          </div>
        ) : null}
        {reached.length ? (
          <RowGroup
            title={`${count(inc.kept + prb.kept, "mantido", "mantidos")} · ${count(inc.dropped + prb.dropped, "descartado", "descartados")}`}
            rows={reached}
            stage="postfilter"
            onCite={onCite}
          />
        ) : null}
      </li>
    </ol>
  );
}

function RowGroup({
  title,
  rows,
  stage,
  onCite,
}: {
  title: string;
  rows: RetrievalRow[];
  stage: "vector" | "postfilter";
  onCite: (n: string) => void;
}) {
  if (!rows.length) {
    return <div className="layer-empty">{title.split(" · ")[0]}: nenhum resultado.</div>;
  }
  return (
    <div className="rows">
      <div className="rows-title">{title}</div>
      <ul className="rows-list">
        {rows.map((r) => {
          const pill =
            stage === "vector"
              ? r.outcome === "abaixo"
                ? { cls: "drop", label: "abaixo do limiar" }
                : { cls: "keep", label: "passou" }
              : r.outcome === "descartado"
                ? { cls: "drop", label: OUTCOME_LABEL.descartado }
                : { cls: "keep", label: OUTCOME_LABEL[r.outcome] };
          const openable = r.kind === "incidente";
          return (
            <li
              key={`${stage}-${r.number}`}
              className={`row${pill.cls === "drop" ? " is-dropped" : ""}${openable ? " is-openable" : ""}`}
              {...(openable
                ? activate(() => onCite(r.number), `${r.number} · ${r.desc}`)
                : {})}
            >
              <span className="row-num mono">{r.number}</span>
              <span className="row-desc">{r.desc}</span>
              <span className="row-sim mono" title="Similaridade de cosseno">
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function IdChip({ id, onCite }: { id: string; onCite: (n: string) => void }) {
  if (id.startsWith("INC")) {
    return (
      <button type="button" className="cite" onClick={() => onCite(id)}>
        {id}
      </button>
    );
  }
  return (
    <span className="cite cite-prb" title={`Problema ${id}`}>
      {id}
    </span>
  );
}
