"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, ViewTransition } from "react";

import { useAulaStart } from "@/components/aula";
import { ConceptLabel, RecordTag, TechDetails } from "@/components/concepts";
import { showTop } from "@/lib/reveal";
import { Icons } from "@/components/icons";
import { useShell } from "@/components/app-shell";
import {
  IdChip,
  PipelineTrace,
  RunStatus,
  usePipelineLesson,
  type RunPhase,
} from "@/components/pipeline-trace";
import { SimilarityRuler } from "@/components/similarity-ruler";
import {
  Avatar,
  MetaLine,
  PriorityBadge,
  StateBadge,
  StateBlock,
  WakeNotice,
} from "@/components/ui";
import { activate, useFocusTrap, useScrollLock } from "@/lib/a11y";
import { api } from "@/lib/api";
import {
  afterAskError,
  askNote,
  followUpBody,
  inputHint,
  joinPt,
  QUESTION_MAX,
  questionCount,
  readChat,
  restartTurns,
  saveChat,
  settleTurns,
  upsertTurn,
  type Turn,
} from "@/lib/followup";
import { useAllIncidents, useClusters, useIncident } from "@/lib/incidents";
import { useProblems } from "@/lib/problems";
import { usePrefersReducedMotion } from "@/lib/motion";
import {
  absDate,
  buildSuggestionMarkdown,
  linkedProblem,
  recurrenceView,
  relatedNumbers,
  groupPlain,
  mapDetail,
  mapSuggest,
  markdownToPlain,
  activityWithNotes,
  relTime,
  type DsState,
  type IncidentRecord,
} from "@/lib/model";
import { DEFAULT_MODEL, MODELS, modelName, modelNameFromRoute } from "@/lib/models";
import {
  BEATS,
  analysisButton,
  PIPELINE_STEPS,
  formatSim,
  layerShown,
  mergeNotes,
  retrievalRows,
  stepReveal,
  stepViews,
} from "@/lib/pipeline";
import { funnel } from "@/lib/ruler";
import type { SuggestResponse, WorkNote } from "@/lib/types";
import { AssistantFab } from "@/components/assistant-fab";
import { SuggestionMarkdown } from "@/components/markdown";
import { isSuggestResponse, suggestErrorMessage } from "@/lib/suggest-guard";

import "./pipeline.css";
import { keepWhole } from "@/lib/text";

type Tab = "detalhes" | "analise" | "atividade" | "relacionados";

/** The live pipeline run for one incident, shared by the assistant panel and the
 * "Análise da IA" tab so both show the same result. */
export interface SuggestionRun {
  phase: RunPhase;
  response: SuggestResponse | null;
  error: string | null;
  /** Date.now() when the request left (null when idle). */
  startedAt: number | null;
  /** Round trip of the last answered request, in ms. */
  durationMs: number | null;
  model: string;
  setModel: (id: string) => void;
  /** A new analysis. ``keepChat``: a silent re-sync for a waiting question. */
  run: (opts?: { keepChat?: boolean }) => Promise<void>;
  /** Questions typed in the assistant chat, kept with the analysis. */
  turns: Turn[];
  setTurns: (update: (turns: Turn[]) => Turn[]) => void;
  /** A new analysis cleared the conversation about the previous one. */
  restarted: boolean;
}

function useSuggestion(record: IncidentRecord): SuggestionRun {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [response, setResponse] = useState<SuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [restarted, setRestarted] = useState(false);
  const busy = useRef(false);

  // Leaving the incident and coming back in the same tab brings the analysis
  // and the chat back, so nobody pays for (and publishes) the same analysis
  // twice (E2E-4 P2-3).
  useEffect(() => {
    const kept = readChat(record.number);
    if (!kept) return;
    setResponse(kept.response);
    setDurationMs(kept.durationMs);
    if (MODELS.some((m) => m.id === kept.model)) setModel(kept.model);
    setTurns(kept.turns);
    setPhase("done");
  }, [record.number]);
  useEffect(() => {
    if (response) saveChat(record.number, { response, durationMs, model, turns });
  }, [record.number, response, durationMs, model, turns]);

  async function run({ keepChat = false }: { keepChat?: boolean } = {}) {
    if (busy.current) return;
    busy.current = true;
    // Analysing again starts a new conversation (E2E-5 P1-2); a re-sync after
    // a lost analysis keeps it, since the question is about to be asked.
    if (!keepChat && response) {
      const next = restartTurns(turns);
      setTurns(next.turns);
      setRestarted(next.restarted || restarted);
    }
    const t0 = Date.now();
    setStartedAt(t0);
    setPhase("running");
    setError(null);
    try {
      const res = await api.suggest({
        number: record.number,
        short_description: record.short,
        description: record.description,
        category: record.category,
        subcategory: record.subcategory,
        empresa: record.empresa,
        cmdb_ci: record.service,
        priority: Number(record.priority.slice(1)),
        model,
      });
      setDurationMs(Date.now() - t0);
      if (!isSuggestResponse(res)) {
        setError("A análise voltou incompleta. Tente de novo.");
        setPhase("error");
        return;
      }
      setResponse(res);
      setPhase("done");
    } catch (e) {
      setError(suggestErrorMessage(e));
      setPhase("error");
    } finally {
      busy.current = false;
    }
  }

  return {
    phase,
    response,
    error,
    startedAt,
    durationMs,
    model,
    setModel,
    run,
    turns,
    setTurns,
    restarted,
  };
}

interface RelatedRow {
  number: string;
  short: string;
  service: string;
  state: DsState;
}

function dsStateFromSummary(state: string): DsState {
  return state === "Resolved" || state === "Closed"
    ? "resolved"
    : state === "In Progress"
      ? "progress"
      : state === "On Hold"
        ? "hold"
        : "open";
}

export default function DetailPage() {
  const params = useParams<{ number: string }>();
  const number = params.number;
  const shell = useShell();
  const { data, loading, error, errorStatus, slow, retry } = useIncident(number);

  const record = useMemo(() => (data ? mapDetail(data) : null), [data]);

  if (loading) {
    return (
      <div className="detail-single" aria-busy="true">
        <Crumbs number={number} />
        <WakeNotice show={slow} />
        <div className="card record-card">
          <div className="record-head record-skel">
            {/* The number is known from the URL: it lands here from the list. */}
            <ViewTransition name={`inc-${number}`} share="morph" default="none">
              <span className="record-num mono">{number}</span>
            </ViewTransition>
            <span className="sk sk-title" />
            <span className="sk sk-meta" />
          </div>
          <div className="section record-skel">
            <span className="sk sk-line" />
            <span className="sk sk-line" />
            <span className="sk sk-short" />
          </div>
        </div>
      </div>
    );
  }

  if (errorStatus === 404) {
    return (
      <div className="detail-single">
        <Crumbs number={number} />
        <StateBlock
          icon={Icons.alert}
          variant="error"
          title="Incidente não encontrado"
          action={
            <Link href="/incidentes" className="btn btn-primary btn-sm">
              Ver todos os incidentes
            </Link>
          }
        >
          Não existe um incidente com o número {number}. Confira o número ou escolha um na
          lista.
        </StateBlock>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="detail-single">
        <Crumbs number={number} />
        <StateBlock
          icon={Icons.alert}
          variant="error"
          title="Não foi possível abrir o incidente"
          action={
            <div className="state-actions">
              <button className="btn btn-outline btn-sm" onClick={retry}>
                <Icons.retry />
                Tentar de novo
              </button>
              <Link href="/incidentes" className="btn btn-ghost btn-sm">
                Voltar para incidentes
              </Link>
            </div>
          }
        >
          {error ?? "O servidor não devolveu este incidente."}
        </StateBlock>
      </div>
    );
  }

  // Key by number so each incident gets a fresh Detail (state, tabs, copilot) —
  // no manual cross-record reset needed.
  return <Detail key={record.number} record={record} peek={shell.peek} />;
}

function Crumbs({ number }: { number: string }) {
  return (
    <nav className="crumbs" aria-label="Você está em">
      <Link href="/incidentes" transitionTypes={["nav-back"]}>
        Incidentes
      </Link>
      <span aria-hidden="true">/</span>
      <span className="mono" aria-current="page">
        {number}
      </span>
    </nav>
  );
}

function WorkNotes({
  notes,
  fresh,
  onCite,
}: {
  notes: WorkNote[];
  fresh: string | null;
  onCite: (n: string, el?: HTMLElement) => void;
}) {
  const { flashCite } = useShell();
  if (!notes.length) {
    return (
      <p className="worknotes-empty">
        Nenhuma nota ainda. Quando a IA sugerir uma solução, ela aparece aqui com as
        fontes.
      </p>
    );
  }
  return (
    <div className="worknotes">
      {notes.map((note) => (
        <article
          key={note.id}
          id={`note-${note.id}`}
          className={`worknote${note.id === fresh ? " is-fresh" : ""}`}
        >
          <div className="worknote-head">
            <b>
              <Icons.aiSpark size={13} />
              {note.author}
            </b>
            <span title={absDate(note.created_at)}>
              publicou {relTime(note.created_at)}
            </span>
            {note.model ? <span>· {modelNameFromRoute(note.model)}</span> : null}
          </div>
          <SuggestionMarkdown
            source={buildSuggestionMarkdown(note.text, note.sources)}
            onCite={onCite}
            flashCite={flashCite}
          />
          {note.sources.length ? (
            <div className="worknote-src">
              Fontes:
              {note.sources.map((id) => (
                <button
                  type="button"
                  className={`cite${id.startsWith("PRB") ? " cite-prb" : ""}`}
                  key={id}
                  onClick={(e) => onCite(id, e.currentTarget)}
                  aria-label={
                    id.startsWith("PRB")
                      ? `Abrir problema ${id}`
                      : `Abrir incidente ${id}`
                  }
                >
                  {id}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Detail({ record, peek }: { record: IncidentRecord; peek: (n: string) => void }) {
  const { flashCite } = useShell();
  const [tab, setTab] = useState<Tab>("detalhes");
  const [inserted, setInserted] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [localState, setLocalState] = useState<DsState>(record.state);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashToast(msg: string, ms = 2200) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }
  useEffect(
    () => () => void (toastTimer.current && clearTimeout(toastTimer.current)),
    [],
  );

  const suggest = useSuggestion(record);
  const [freshNote, setFreshNote] = useState<string | null>(null);
  const notes = useMemo(
    () => mergeNotes(record.publishedNotes, suggest.response?.publication.note),
    [record.publishedNotes, suggest.response],
  );
  // One source for the AI note: the same list as "Notas de trabalho".
  const activity = useMemo(
    () => activityWithNotes(record.activity, notes),
    [record.activity, notes],
  );

  // Both AI buttons (top of the record and the empty resolution notes) open
  // the analysis tab and start a run when there is no answer yet. The page
  // moves only when the tabs sit below the fold, and then once, to their top.
  function startAnalysis() {
    setTab("analise");
    if (!suggest.response && suggest.phase !== "running") void suggest.run();
    requestAnimationFrame(() => {
      const tabs = document.querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Seções do incidente"]',
      );
      if (tabs) showTop(tabs, reduced);
    });
  }

  // The header's "Modo aula" starts this screen's lesson: the analysis, or
  // its replay once the tab is open (the trace registers that one).
  useAulaStart("incidente", tab === "analise" && suggest.response ? null : startAnalysis);

  function showNotes() {
    const latest = notes[notes.length - 1];
    setTab("detalhes");
    setFreshNote(latest?.id ?? null);
    requestAnimationFrame(() =>
      document
        .getElementById(latest ? `note-${latest.id}` : "worknotes")
        ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }),
    );
  }

  const { data: all } = useAllIncidents();
  const { data: clustersData } = useClusters();

  const { data: problemList } = useProblems();
  const problem = useMemo(
    () => linkedProblem(record.number, problemList ?? []),
    [record.number, problemList],
  );
  const recurrence = recurrenceView(record);

  const { related, relatedTotal } = useMemo(() => {
    const summaries = all?.items ?? [];
    const byNumber = new Map(summaries.map((s) => [s.number, s]));
    const found = relatedNumbers(record, summaries, clustersData?.points ?? [])
      .map((id) => byNumber.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    return {
      relatedTotal: found.length,
      related: found.slice(0, 6).map<RelatedRow>((s) => ({
        number: s.number,
        short: s.short_description,
        service: s.cmdb_ci,
        state: dsStateFromSummary(s.state),
      })),
    };
  }, [all, clustersData, record]);

  function doAssign() {
    const next = assignee ? null : "João Ferreira (você)";
    setAssignee(next);
    flashToast(next ? "Incidente atribuído a você" : "Atribuição removida", 2000);
  }
  function doResolve() {
    const next: DsState = localState === "resolved" ? "open" : "resolved";
    setLocalState(next);
    flashToast(
      next === "resolved"
        ? "Incidente marcado como resolvido (demonstração)"
        : "Incidente reaberto",
    );
  }
  function doInsert(text: string) {
    setInserted(text);
    setCopilotOpen(false);
    setTab("detalhes");
    flashToast("Rascunho inserido nas notas de resolução", 2400);
    requestAnimationFrame(() =>
      document
        .getElementById("resnotes")
        ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" }),
    );
  }
  function doDiscard() {
    setInserted(null);
    flashToast("Rascunho descartado", 1800);
  }
  function doCopy(text: string) {
    // Only say "copiada" once it is: http pages and iframes have no clipboard.
    const failed = () => flashToast("Não deu para copiar aqui. Selecione o texto.", 2400);
    if (!navigator.clipboard) return failed();
    navigator.clipboard
      .writeText(text)
      .then(() => flashToast("Sugestão copiada", 1800), failed);
  }

  // id: a system name (service, group); Inter like the rest, kept whole.
  const fields: { label: string; value: string; id?: boolean }[] = [
    { label: "Categoria", value: record.category },
    { label: "Subcategoria", value: record.subcategory },
    { label: "Empresa", value: record.empresa },
    { label: "Serviço afetado", value: record.service, id: true },
    { label: "Grupo de atendimento", value: groupPlain(record.group), id: true },
    { label: "Impacto", value: record.impact },
    { label: "Urgência", value: record.urgency },
  ];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "detalhes", label: "Detalhes" },
    { id: "analise", label: "Análise da IA" },
    { id: "atividade", label: "Atividade", count: activity.length },
    {
      id: "relacionados",
      label: "Vínculos",
      count: relatedTotal + (problem ? 1 : 0),
    },
  ];

  return (
    <div className="detail-single">
      <Crumbs number={record.number} />

      <div className="card record-card">
        <div className="record-head">
          <div className="top-row">
            <div className="record-title">
              <div className="row">
                <ViewTransition
                  name={`inc-${record.number}`}
                  share="morph"
                  default="none"
                >
                  <span className="record-num">
                    <RecordTag number={record.number} size="lg" />
                  </span>
                </ViewTransition>
                <StateBadge state={localState} />
                <PriorityBadge priority={record.priority} withWord />
              </div>
              <h1>{keepWhole(record.title)}</h1>
              <div className="meta">
                <MetaLine
                  items={[
                    record.service,
                    groupPlain(record.group),
                    localState === "resolved"
                      ? "resolvido"
                      : `aberto em ${record.opened}`,
                    assignee,
                  ]}
                />
              </div>
            </div>
            <div className="record-actions">
              {/* The AI is the point of the screen: its button comes first and
                  is the only filled one. Atribuir and Resolver are outlined so
                  nobody mistakes Resolver for "let the AI solve it". */}
              <button className="btn btn-ai btn-sm record-ai" onClick={startAnalysis}>
                <Icons.aiSpark />
                {analysisButton(suggest.response)}
              </button>
              <button
                className={`btn btn-outline btn-sm${assignee ? " is-on" : ""}`}
                onClick={doAssign}
                aria-pressed={Boolean(assignee)}
              >
                {assignee ? <Icons.checkCircle /> : <Icons.assign />}
                {assignee ? "Atribuído" : "Atribuir"}
              </button>
              <button className="btn btn-outline btn-sm" onClick={doResolve}>
                {localState === "resolved" ? <Icons.retry /> : <Icons.human />}
                {localState === "resolved" ? "Reabrir" : "Resolver"}
              </button>
            </div>
          </div>
        </div>

        <TabList tabs={tabs} current={tab} onChange={setTab} />

        <div
          className="tab-panel"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === "detalhes" ? (
            <div className="rec-body">
              <section className="section rec-desc" aria-labelledby="h-desc">
                <h2 id="h-desc">Descrição</h2>
                <p className="rec-prose">{record.description}</p>
              </section>

              <section className="section rec-res" id="resnotes" aria-labelledby="h-res">
                <h2 id="h-res">Notas de resolução</h2>
                {inserted ? (
                  <div className="resnotes-draft">
                    <p className="draft-label">
                      <Icons.aiSpark size={14} />
                      Rascunho da IA: revise antes de salvar
                    </p>
                    <p className="rec-prose">{inserted}</p>
                    <button className="btn btn-ghost btn-sm" onClick={doDiscard}>
                      <Icons.close />
                      Descartar rascunho
                    </button>
                  </div>
                ) : record.resolutionNotes ? (
                  <p className="rec-prose">{record.resolutionNotes}</p>
                ) : (
                  <div className="resnotes-empty k-ai-step-box">
                    <ConceptLabel concept="ai-step">Ainda sem solução</ConceptLabel>
                    <p>
                      A IA pode procurar incidentes parecidos que já foram resolvidos e
                      sugerir uma solução. Você revisa antes de usar.
                    </p>
                    <button className="btn btn-ai" onClick={startAnalysis}>
                      <Icons.aiSpark />
                      {suggest.response
                        ? analysisButton(suggest.response)
                        : suggest.phase === "running"
                          ? "Analisando"
                          : "Analisar com a IA"}
                    </button>
                  </div>
                )}
                {record.closeCode ? (
                  <div className="field rec-close">
                    <span className="field-label">Tipo de encerramento</span>
                    <span className="val">{record.closeCode}</span>
                  </div>
                ) : null}
              </section>

              <section className="section rec-aside" aria-labelledby="h-class">
                <h2 id="h-class">Classificação</h2>
                <dl className="fields">
                  {fields.map((f) => (
                    <div className="field" key={f.label}>
                      <dt>{f.label}</dt>
                      <dd className="val">{f.id ? keepWhole(f.value) : f.value}</dd>
                    </div>
                  ))}
                  {problem ? (
                    <div className="field full">
                      <dt>Problema</dt>
                      <dd className="val">
                        <Link className="rec-link" href={`/problemas/${problem.number}`}>
                          <span className="mono">{problem.number}</span>{" "}
                          {problem.short_description}
                          <Icons.chevronRight size={14} />
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                  {recurrence ? (
                    <div className="field full">
                      <dt>Repetições</dt>
                      <dd className="val">
                        {recurrence.href ? (
                          <Link className="rec-link" href={recurrence.href}>
                            {recurrence.label}
                            <Icons.chevronRight size={14} />
                          </Link>
                        ) : (
                          recurrence.label
                        )}
                      </dd>
                    </div>
                  ) : null}
                  <div className="field full">
                    <dt>Tags</dt>
                    <dd className="val">
                      {record.tags.length ? (
                        <span className="tag-list">
                          {record.tags.map((t) => (
                            <span className="tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">Sem tags</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                className="section rec-work"
                id="worknotes"
                aria-labelledby="h-work"
              >
                <h2 id="h-work">Notas de trabalho</h2>
                <WorkNotes notes={notes} fresh={freshNote} onCite={peek} />
              </section>
            </div>
          ) : tab === "analise" ? (
            <PipelineTrace
              phase={suggest.phase}
              result={suggest.response}
              error={suggest.error}
              modelName={modelName(suggest.model)}
              source={{
                description: record.description,
                category: record.category,
                subcategory: record.subcategory,
                empresa: record.empresa,
                tags: record.tags,
              }}
              startedAt={suggest.startedAt}
              durationMs={suggest.durationMs}
              onRun={() => void suggest.run()}
              onCite={peek}
              flashCite={flashCite}
              onShowNotes={showNotes}
              onAsk={() => setCopilotOpen(true)}
              onInsert={doInsert}
              onCopy={doCopy}
            />
          ) : tab === "atividade" ? (
            <section className="section" aria-labelledby="h-act">
              <h2 id="h-act">Linha do tempo</h2>
              <ol className="activity">
                {activity.map((a, i) => (
                  <li className="act" key={i}>
                    <Avatar who={a.who} cls={`kind-${a.kind}`} />
                    <div className="act-body">
                      <div className="act-meta">
                        <span className="who">{a.who.name}</span>
                        <span className="when">{a.when}</span>
                      </div>
                      <div className="act-text">{a.text}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section className="section" aria-labelledby="h-rel">
              {problem ? (
                <>
                  <h2 id="h-rel">Problema ligado</h2>
                  <div className="related">
                    <Link className="rel-row" href={`/problemas/${problem.number}`}>
                      <span className="num">
                        <RecordTag number={problem.number} size="sm" />
                      </span>
                      <span className="rdesc">{problem.short_description}</span>
                      <span className="svc mono">{keepWhole(problem.cmdb_ci)}</span>
                    </Link>
                  </div>
                </>
              ) : null}
              <h2 id={problem ? undefined : "h-rel"}>
                Incidentes do mesmo serviço ou do mesmo grupo
              </h2>
              {relatedTotal > related.length ? (
                <p className="rel-empty">
                  Mostrando {related.length} de {relatedTotal}.
                </p>
              ) : null}
              {related.length ? (
                <div className="related">
                  {related.map((r) => (
                    <div
                      className="rel-row"
                      key={r.number}
                      {...activate(() => peek(r.number), `${r.number} · ${r.short}`)}
                    >
                      <span className="num">
                        <RecordTag number={r.number} size="sm" />
                      </span>
                      <span className="rdesc">{r.short}</span>
                      <span className="svc mono">{keepWhole(r.service)}</span>
                      <StateBadge state={r.state} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rel-empty">
                  Nenhum outro incidente no mesmo serviço ou no mesmo grupo de repetições.
                </p>
              )}
            </section>
          )}
        </div>
      </div>

      <CopilotFab
        record={record}
        suggest={suggest}
        open={copilotOpen}
        setOpen={setCopilotOpen}
        onInsert={doInsert}
        onCopy={doCopy}
        onOpenAnalysis={() => setTab("analise")}
      />

      <div className="toast-slot" role="status" aria-live="polite">
        {toast ? (
          <div className="toast">
            <Icons.checkCircle size={16} />
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Record tabs with the WAI-ARIA keyboard pattern (arrows, Home, End). On a
 * phone the row scrolls sideways; a fade on the edge says there is more. */
function TabList({
  tabs,
  current,
  onChange,
}: {
  tabs: { id: Tab; label: string; count?: number }[];
  current: Tab;
  onChange: (t: Tab) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdge({
        start: el.scrollLeft > 2,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Keep the selected tab in view when the row scrolls sideways.
  useEffect(() => {
    const el = ref.current;
    const btn = el?.querySelector<HTMLElement>(`#tab-${current}`);
    if (!el || !btn) return;
    const left = btn.offsetLeft - 24;
    const right = btn.offsetLeft + btn.offsetWidth + 24 - el.clientWidth;
    if (el.scrollLeft > left) el.scrollLeft = left;
    else if (el.scrollLeft < right) el.scrollLeft = right;
  }, [current]);

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === current);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    ref.current?.querySelector<HTMLElement>(`#tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div
      ref={ref}
      className={`tabs${edge.start ? " more-start" : ""}${edge.end ? " more-end" : ""}`}
      role="tablist"
      aria-label="Seções do incidente"
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          className={`tab${t.id === current ? " on" : ""}`}
          role="tab"
          aria-selected={t.id === current}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === current ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null ? <span className="tab-n">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ===========================================================================
//  Floating copilot, the AI assistant. Animated pipeline trace over the live RAG call.
// ===========================================================================

function CopilotFab({
  record,
  suggest,
  open,
  setOpen,
  onInsert,
  onCopy,
  onOpenAnalysis,
}: {
  record: IncidentRecord;
  suggest: SuggestionRun;
  open: boolean;
  setOpen: (open: boolean) => void;
  onInsert: (text: string) => void;
  onCopy: (text: string) => void;
  onOpenAnalysis: () => void;
}) {
  const { peek, flashCite, autoSuggestFor, consumeAutoSuggest } = useShell();

  const phase = suggest.phase;
  const result = useMemo(
    () => (suggest.response ? mapSuggest(suggest.response) : null),
    [suggest.response],
  );
  const errMsg = suggest.error;
  const [why, setWhy] = useState(false);
  const model = suggest.model;
  const [modelOpen, setModelOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lastMessage, setLastMessage] = useState("Sugerir resolução para este incidente");
  // Typed questions: each one is a follow-up answered from the incident and
  // the analysis the server kept, never a new analysis. One typed before the
  // analysis (or while it runs) waits for it and is asked right after.
  const { turns, setTurns } = suggest;
  const count = questionCount(draft.length);
  const msgsRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  // On phones the panel is a full-height sheet; keep the record from scrolling under it.
  useScrollLock(open);
  const curModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  // The same honest replay as the "Análise da IA" tab, in compact form. It
  // only runs while the panel is open, so a closed panel never takes the
  // modo aula caption bar from the tab.
  const shown = phase === "done" ? suggest.response : null;
  // In modo aula the panel teaches only an analysis it ran itself ("Sugerir
  // resolução" here). Opened on one the tab already taught (step 7's "Fazer
  // uma pergunta", the button, a silent re-sync), its lesson starts at the
  // last step, so the bar never goes back to "Etapa 1 de 7".
  const [teach, setTeach] = useState(false);
  useEffect(() => {
    if (!open) setTeach(false);
  }, [open]);
  const lesson = usePipelineLesson("aurora", open ? shown : null, {
    startAt: teach ? "first" : "end",
  });
  const beat = shown ? lesson.step : -1;
  const views = useMemo(() => (shown ? stepViews(shown) : null), [shown]);
  const reached = (key: (typeof BEATS)[number]["step"]) =>
    stepReveal(key, beat) !== "hidden";

  // Close on Escape (closing the model menu first if it is open).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (modelOpen) setModelOpen(false);
      else setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, modelOpen, setOpen]);

  async function run() {
    if (phase === "running") return;
    setWhy(false);
    setSrcOpen(false);
    await suggest.run();
  }

  async function ask(turn: Turn) {
    setTurns((all) =>
      upsertTurn(all, { ...turn, state: "running", res: null, error: null }),
    );
    try {
      const res = await api.askIncident(
        record.number,
        followUpBody(suggest.response, turn.question, model),
      );
      setTurns((all) =>
        upsertTurn(all, {
          ...turn,
          state: "done",
          res,
          error: null,
          needsAnalysis: false,
        }),
      );
    } catch (e) {
      // 409: the server holds no analysis for this visitor (a restart, or it
      // never ran), or another tab's. The analysis runs again once, without
      // clearing the chat, and the question is asked after it (logica-5 P1-1).
      const next = afterAskError(turn, e);
      setTurns((all) => upsertTurn(all, next.turn));
      if (next.reanalyze) void suggest.run({ keepChat: true });
    }
  }

  /** "Analisar de novo" on a question that waits or lost its analysis. */
  function resync(turn: Turn) {
    if (turn.state === "error")
      setTurns((all) =>
        upsertTurn(all, { ...turn, state: "waiting", error: null, needsAnalysis: false }),
      );
    void suggest.run({ keepChat: true });
  }

  // A written message is a question. The server answers a greeting at once
  // and anything else from the analysis it kept; with none, it says so (409)
  // and the analysis runs first. Sent while the analysis runs, it waits.
  function submit() {
    const text = draft.trim().slice(0, QUESTION_MAX);
    if (!text) return;
    if (turns.some((t) => t.state === "running")) return;
    setDraft("");
    const turn: Turn = {
      id: Date.now(),
      question: text,
      state: "waiting",
      res: null,
      error: null,
    };
    if (phase === "running") {
      setTurns((all) => upsertTurn(all, turn));
      return;
    }
    void ask(turn);
  }

  // The analysis landed: ask the questions that waited for it, one at a time.
  // After a failed analysis they stay, with its retry.
  useEffect(() => {
    if (turns.some((t) => t.state === "running")) return;
    const [next] = settleTurns(turns, phase).ask;
    if (next) void ask(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, turns]);

  function askDefault() {
    setLastMessage("Sugerir resolução para este incidente");
    setTeach(true);
    run();
  }

  // External trigger (⌘K "Sugerir resolução").
  useEffect(() => {
    if (autoSuggestFor === record.number) {
      setOpen(true);
      askDefault();
      consumeAutoSuggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggestFor, record.number]);

  // Keep the chat scrolled to the newest content; in modo aula, to the step
  // being explained.
  useEffect(() => {
    const box = msgsRef.current;
    if (!box) return;
    const current = lesson.aula
      ? box.querySelector<HTMLElement>('.mini-step[aria-current="step"]')
      : null;
    if (current) current.scrollIntoView({ block: "start", behavior: "auto" });
    else box.scrollTop = box.scrollHeight;
  }, [phase, beat, why, open, srcOpen, lesson.aula, turns]);

  const started = phase !== "idle";

  const rail = (
    <ol
      className={`mini-rail${shown ? "" : " is-outline"}`}
      aria-label="Etapas da análise"
      aria-busy={phase === "running"}
    >
      {PIPELINE_STEPS.map((def) => {
        const view = views?.find((v) => v.key === def.key) ?? null;
        const reveal = view ? stepReveal(def.key, beat) : "hidden";
        const stopped =
          def.key === "classificar" &&
          reveal !== "hidden" &&
          views?.find((v) => v.key === "sugerir")?.status === "pulada";
        return (
          <li
            key={def.key}
            className={`mini-step is-${reveal}${view && reveal !== "hidden" ? ` st-${view.status}` : ""}${
              def.gate ? " is-gate" : ""
            }${stopped ? " is-stopped" : ""}`}
            aria-current={reveal === "current" ? "step" : undefined}
          >
            <span className="mini-marker" aria-hidden="true">
              {reveal === "done" && view?.status === "concluida" && !stopped ? (
                <Icons.check size={12} sw={3} />
              ) : (
                def.order
              )}
            </span>
            <div className="mini-body">
              <b>{def.title}</b>
              {view && reveal !== "hidden" ? (
                def.key === "buscar" && shown ? (
                  <MiniSearch result={shown} beat={beat} onOpen={peek} />
                ) : (
                  <span className="mini-decision">
                    {def.key === "sugerir" && view.status === "pulada"
                      ? "Não se aplica."
                      : view.decisions[0]}
                  </span>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );

  const traceBlock = (
    <div className={`think${phase === "running" ? "" : " done"}`}>
      <RunStatus
        compact
        running={phase === "running"}
        startedAt={suggest.startedAt}
        durationMs={shown ? suggest.durationMs : null}
        replaying={Boolean(shown) && !lesson.done}
        aula={lesson.aula}
        onSkip={lesson.skip}
        onReplay={lesson.play}
      />
      {phase === "error" ? null : rail}
    </div>
  );

  const sourcesBlock = result?.sources.length ? (
    <div className="sources cop-reveal reveal-3">
      <button
        className={`src-toggle${srcOpen ? " open" : ""}`}
        onClick={() => setSrcOpen((s) => !s)}
      >
        <Icons.list size={15} />
        <span className="src-tt">Fontes que a IA consultou</span>
        <span className="src-count">{result.sources.length}</span>
        <Icons.chevronDown size={14} />
      </button>
      {srcOpen ? (
        <div className="cands">
          <div className="src-hint">
            Abra um caso para conferir. O número é a similaridade, de 0 a 1.
          </div>
          {result.sources.map((c) => (
            <div
              key={c.id}
              className={`cand${c.keep ? "" : " dropped"}`}
              data-kind={c.kind}
              title={c.reason ?? ""}
              {...activate(() => peek(c.id), `${c.id} · ${c.desc}`)}
            >
              <span className="num">{c.id}</span>
              <span className="cdesc">
                {c.kind === "problema" ? "Problema: " : ""}
                {c.desc}
              </span>
              <span className="sim" title="Similaridade semântica, de 0 a 1">
                {formatSim(c.sim)}
              </span>
              <span className={`pill ${c.keep ? "pill-keep" : "pill-drop"}`}>
                {c.keep ? "usado" : "descartado"}
              </span>
              <span className="open">
                <Icons.external size={15} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const results =
    phase === "done" && result && reached("classificar") ? (
      <>
        <div
          className={`verdict-card cop-reveal ${result.verdict === "PROCEDENTE" ? "ok" : "bad"}`}
        >
          <span className="vc-ico">
            {result.verdict === "PROCEDENTE" ? <Icons.checkCircle /> : <Icons.alert />}
          </span>
          <div className="vc-text">
            <div className="vc-label">
              {result.verdict === "PROCEDENTE"
                ? "Procedente (é um incidente)"
                : "Improcedente (não é um incidente)"}
            </div>
            <div className="vc-sub">
              {result.verdict === "IMPROCEDENTE"
                ? "Este chamado não é uma falha do sistema. É um pedido de autoatendimento ou dúvida."
                : result.noBase
                  ? `É um incidente de verdade. ${result.empty?.line ?? ""}`
                  : "É um incidente de verdade. A resolução sugerida está abaixo."}
            </div>
          </div>
        </div>

        {result.verdict === "IMPROCEDENTE" || result.noBase ? (
          <div className="improcedente cop-reveal reveal-1">
            <div className="imp-head">
              {result.verdict === "IMPROCEDENTE" ? <Icons.alert /> : <Icons.inbox />}
              {result.verdict === "IMPROCEDENTE"
                ? "Por que não é um incidente"
                : "Sem sugestão desta vez"}
            </div>
            {result.verdict === "IMPROCEDENTE"
              ? "É um pedido de autoatendimento (por exemplo, redefinir a senha), e não a falha de um sistema. O melhor caminho é orientar o cliente pelo próprio autoatendimento, sem abrir um incidente técnico."
              : result.empty?.kind === "unwritten"
                ? "Analise de novo, ou resolva manualmente e registre a solução."
                : "Resolva manualmente e registre a solução: ela passa a alimentar o copiloto nos próximos casos."}
          </div>
        ) : (
          <>
            {result.suggestion && reached("sugerir") ? (
              <div className="suggestion cop-reveal reveal-2">
                <h3>Resolução sugerida</h3>
                <SuggestionMarkdown
                  source={result.suggestion}
                  onCite={peek}
                  flashCite={flashCite}
                />
                <div className="sugg-foot">
                  <p>
                    {result.cited.length > 0
                      ? `Fundamentado em ${joinPt(result.cited)}.`
                      : "Sem fonte citada: confira antes de usar."}
                  </p>
                  <TechDetails summary="Detalhes técnicos">
                    <p>
                      Gerado por <b>{curModel.name}</b>.
                    </p>
                  </TechDetails>
                </div>
              </div>
            ) : null}
            {result.suggestion && lesson.done ? (
              <div className="cop-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onInsert(markdownToPlain(result.suggestion ?? ""))}
                >
                  <Icons.insert />
                  Inserir nas notas
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => onCopy(markdownToPlain(result.suggestion ?? ""))}
                >
                  <Icons.copy />
                  Copiar
                </button>
              </div>
            ) : null}
            <button
              className={`why-toggle${why ? " open" : ""}`}
              onClick={() => setWhy((w) => !w)}
            >
              Por que essa sugestão?
              <Icons.chevronDown />
            </button>
            {why ? (
              <div className="why">
                <b>Procedente</b> quer dizer que o chamado é mesmo um incidente que
                precisa de tratativa. Os casos marcados como <b>usado</b> são incidentes
                parecidos que já foram resolvidos, então servem de base para a sugestão.
                Já um pedido como “esqueci minha senha” entra como <b>improcedente</b>,
                porque é autoatendimento e não uma falha do sistema.
              </div>
            ) : null}
            {sourcesBlock}
          </>
        )}
        <button
          className="btn btn-outline btn-sm cop-full"
          onClick={() => {
            setOpen(false);
            onOpenAnalysis();
          }}
        >
          <Icons.list />
          Ver as sete etapas no incidente
        </button>
      </>
    ) : phase === "error" ? (
      <div className="improcedente cop-reveal">
        <div className="imp-head">
          <Icons.alert />
          Não consegui responder agora
        </div>
        {errMsg}
        <div className="imp-actions">
          <button className="btn btn-outline btn-sm" onClick={run}>
            <Icons.retry />
            Tentar de novo
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      <AssistantFab open={open} onOpen={() => setOpen(true)} />

      {open ? (
        <div
          className="cop-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Assistente da IA"
          tabIndex={-1}
          ref={trapRef}
        >
          <div className="cop-panel-head">
            <span className="cph-mark">
              <Icons.aiSpark />
            </span>
            <div className="cph-title">
              <div className="t">Assistente da IA</div>
              <button
                className="model-pick"
                onClick={() => setModelOpen((o) => !o)}
                aria-label="Trocar o modelo de IA"
              >
                <span className="mp-dot" />
                <span className="mp-name">{curModel.name}</span>
                <Icons.chevronDown size={13} />
              </button>
            </div>
            <button
              className="cph-close"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
            >
              <Icons.close />
            </button>
            {modelOpen ? (
              <div className="model-menu">
                <div className="mm-label">Modelo de IA</div>
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    className={`mm-item${m.id === model ? " sel" : ""}`}
                    onClick={() => {
                      suggest.setModel(m.id);
                      setModelOpen(false);
                    }}
                  >
                    <div className="mm-main">
                      <div className="mm-name">{m.name}</div>
                      <div className="mm-desc">{m.desc}</div>
                    </div>
                    {m.id === model ? (
                      <span className="mm-check">
                        <Icons.check size={15} />
                      </span>
                    ) : null}
                  </button>
                ))}
                <div className="mm-foot">
                  O modelo é intercambiável. A forma de fundamentar a resposta (RAG com
                  fontes) não muda.
                </div>
              </div>
            ) : null}
          </div>

          <div className="cop-msgs" ref={msgsRef}>
            <div className="msg-row ai">
              <span className="msg-av">
                <Icons.aiSpark size={15} />
              </span>
              <div className="bubble-ai">
                Posso sugerir uma resolução para o <b className="mono">{record.number}</b>
                , com base em incidentes parecidos que já foram resolvidos. Sempre mostro
                as fontes para você conferir. Depois, respondo dúvidas sobre a sugestão e
                os casos, sem publicar nada.
              </div>
            </div>
            {!started ? (
              <button className="cop-quick" onClick={askDefault}>
                <Icons.aiSpark size={15} />
                <span>Sugerir resolução para este incidente</span>
                <span className="kbd">↵</span>
              </button>
            ) : (
              <>
                <div className="msg-row me">
                  <div className="bubble-user">{lastMessage}</div>
                </div>
                <div className="msg-row ai">
                  <span className="msg-av">
                    <Icons.aiSpark size={15} />
                  </span>
                  <div className="bubble-ai wide">
                    {traceBlock}
                    {results}
                  </div>
                </div>
              </>
            )}
            {suggest.restarted && phase !== "idle" ? (
              <p className="cop-restart" role="status">
                Nova análise: a conversa recomeçou
              </p>
            ) : null}
            {turns.map((t) => (
              <FollowUpTurn
                key={t.id}
                turn={t}
                analysis={phase}
                onCite={peek}
                flashCite={flashCite}
                onRetry={() => void ask(t)}
                onRetryAnalysis={() => resync(t)}
              />
            ))}
          </div>

          <div className="cop-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={QUESTION_MAX}
              placeholder={inputHint(phase === "done" ? suggest.response : null)}
              aria-label="Mensagem para a IA"
              aria-describedby={count ? "cop-count" : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {count ? (
              <span
                id="cop-count"
                className={`cop-count mono${draft.length >= QUESTION_MAX ? " full" : ""}`}
                aria-label={`${draft.length} de ${QUESTION_MAX} caracteres`}
              >
                {count}
              </span>
            ) : null}
            <button className="send" onClick={submit} aria-label="Enviar">
              <Icons.send />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One typed question and its grounded answer. Nothing here is published. */
function FollowUpTurn({
  turn,
  analysis,
  onCite,
  flashCite,
  onRetry,
  onRetryAnalysis,
}: {
  turn: Turn;
  /** The analysis's phase: a waiting question says what it waits for. */
  analysis: RunPhase;
  onCite: (n: string, el?: HTMLElement) => void;
  flashCite: string | null;
  onRetry: () => void;
  onRetryAnalysis: () => void;
}) {
  const note = turn.res ? askNote(turn.res) : null;
  return (
    <>
      <div className="msg-row me">
        <div className="bubble-user">{turn.question}</div>
      </div>
      <div className="msg-row ai" aria-live="polite">
        <span className="msg-av">
          <Icons.aiSpark size={15} />
        </span>
        <div className={`bubble-ai followup is-${turn.res?.kind ?? turn.state}`}>
          {turn.state === "waiting" ? (
            analysis === "error" ? (
              <>
                <p>
                  A análise não terminou, então a pergunta espera. Ela é feita assim que a
                  análise der certo.
                </p>
                <button className="btn btn-outline btn-sm" onClick={onRetryAnalysis}>
                  <Icons.retry />
                  Analisar de novo
                </button>
              </>
            ) : (
              <span className="followup-wait">
                A IA analisa o incidente antes de responder…
              </span>
            )
          ) : turn.state === "running" ? (
            <span className="followup-wait">Lendo o incidente e a análise…</span>
          ) : turn.state === "error" ? (
            <>
              <p>{turn.error}</p>
              {turn.needsAnalysis ? (
                <button className="btn btn-outline btn-sm" onClick={onRetryAnalysis}>
                  <Icons.retry />
                  Analisar de novo
                </button>
              ) : (
                <button className="btn btn-outline btn-sm" onClick={onRetry}>
                  <Icons.retry />
                  Tentar de novo
                </button>
              )}
            </>
          ) : turn.res ? (
            <>
              <SuggestionMarkdown
                source={turn.res.answer}
                onCite={onCite}
                flashCite={flashCite}
              />
              {note ? <p className="followup-note">{note}</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Step 4 in the assistant panel: the funnel and a compact ruler. */
function MiniSearch({
  result,
  beat,
  onOpen,
}: {
  result: SuggestResponse;
  beat: number;
  onOpen: (n: string, el?: HTMLElement) => void;
}) {
  const incidents = retrievalRows(result, "incidente");
  const problems = retrievalRows(result, "problema");
  const f = funnel(result, [...incidents, ...problems]);
  const floor = result.retrieval.vector.min_similarity;
  const showVector = layerShown("vetor", beat);
  const showCheck = layerShown("conferir", beat);
  return (
    <div className="mini-search">
      <span className="mini-decision">
        {result.retrieval.tags.tags.length ? (
          <>
            Tags:{" "}
            {result.retrieval.tags.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </>
        ) : (
          "Sem tags: busca no histórico inteiro."
        )}
      </span>
      {showVector ? (
        <>
          <SimilarityRuler
            compact
            incidents={incidents}
            problems={problems}
            floor={floor}
            onOpen={onOpen}
          />
          <span className="mini-funnel">
            <b className="mono">{f.candidates}</b> candidatos{" → "}
            <b className="mono">{f.passed}</b> com {formatSim(floor)} ou mais
            {showCheck ? (
              <>
                {" → "}
                <b className="mono">{f.kept}</b> mantidos pela IA
              </>
            ) : null}
          </span>
        </>
      ) : null}
      {showCheck && result.context_ids.length ? (
        <span className="mini-ctx">
          {result.context_ids.map((id) => (
            <IdChip key={id} id={id} onCite={onOpen} />
          ))}
        </span>
      ) : null}
    </div>
  );
}
