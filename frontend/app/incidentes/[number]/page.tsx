"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icons, type IconComponent } from "@/components/icons";
import { useShell } from "@/components/app-shell";
import { Avatar, PriorityBadge, StateBadge, StateBlock } from "@/components/ui";
import { activate, useFocusTrap } from "@/lib/a11y";
import { api, ApiError } from "@/lib/api";
import { useAllIncidents, useClusters, useIncident } from "@/lib/incidents";
import { usePrefersReducedMotion } from "@/lib/motion";
import {
  mapDetail,
  mapSuggest,
  markdownToPlain,
  type CopilotResult,
  type DsState,
  type IncidentRecord,
} from "@/lib/model";
import { SuggestionMarkdown } from "@/components/markdown";

type Tab = "detalhes" | "atividade" | "relacionados";

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
  const { data, loading, error } = useIncident(number);

  const record = useMemo(() => (data ? mapDetail(data) : null), [data]);

  if (loading) {
    return (
      <div className="detail-single">
        <div className="crumbs">
          <Link href="/incidentes">Incidentes</Link>
          <span>/</span>
          <span className="mono">{number}</span>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <span className="sk" style={{ width: "60%", height: 18 }} />
          <div style={{ height: 10 }} />
          <span className="sk" style={{ width: "40%" }} />
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <StateBlock
        icon={Icons.alert}
        variant="error"
        title="Incidente não encontrado"
        action={
          <Link href="/incidentes" className="btn btn-primary btn-sm">
            Ir para Incidentes
          </Link>
        }
      >
        {error ?? "O endereço não corresponde a nenhum incidente."}
      </StateBlock>
    );
  }

  // Key by number so each incident gets a fresh Detail (state, tabs, copilot) —
  // no manual cross-record reset needed.
  return <Detail key={record.number} record={record} peek={shell.peek} />;
}

function Detail({ record, peek }: { record: IncidentRecord; peek: (n: string) => void }) {
  const [tab, setTab] = useState<Tab>("detalhes");
  const [inserted, setInserted] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [localState, setLocalState] = useState<DsState>(record.state);
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

  const { data: all } = useAllIncidents();
  const { data: clustersData } = useClusters();

  const related = useMemo<RelatedRow[]>(() => {
    const summaries = all?.items ?? [];
    const byNumber = new Map(summaries.map((s) => [s.number, s]));
    const ids = new Set<string>();
    summaries.forEach((s) => {
      if (s.number !== record.number && s.cmdb_ci === record.service) ids.add(s.number);
    });
    if (record.clusterId != null && clustersData) {
      clustersData.points.forEach((p) => {
        if (p.id !== record.number && p.cluster_id === record.clusterId) ids.add(p.id);
      });
    }
    return [...ids]
      .map((id) => byNumber.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .slice(0, 6)
      .map((s) => ({
        number: s.number,
        short: s.short_description,
        service: s.cmdb_ci,
        state: dsStateFromSummary(s.state),
      }));
  }, [all, clustersData, record.number, record.service, record.clusterId]);

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
    setTab("detalhes");
    flashToast("Rascunho inserido nas notas de resolução", 2400);
  }
  function doCopy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    flashToast("Sugestão copiada", 1800);
  }

  const fields: [string, string, boolean?][] = [
    ["Categoria", record.category],
    ["Subcategoria", record.subcategory],
    ["Serviço afetado (CI)", record.service, true],
    ["Grupo de atendimento", record.group, true],
    ["Impacto", record.impact],
    ["Urgência", record.urgency],
  ];

  return (
    <div className="detail-single">
      <div className="crumbs">
        <Link href="/incidentes">Incidentes</Link>
        <span>/</span>
        <span className="mono">{record.number}</span>
      </div>

      <div className="card record-card">
        <div className="record-head">
          <div className="top-row">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
                minWidth: 0,
              }}
            >
              <div className="row">
                <span className="num mono" style={{ fontSize: 13 }}>
                  {record.number}
                </span>
                <StateBadge state={localState} />
                <PriorityBadge priority={record.priority} withWord />
              </div>
              <h1>{record.title}</h1>
              <div className="meta">
                {`${record.service} · ${record.group} · ${
                  localState === "resolved" ? "resolvido" : `aberto ${record.rel}`
                }${assignee ? ` · ${assignee}` : ""}`}
              </div>
            </div>
            <div className="record-actions">
              <button
                className={`btn btn-outline btn-sm${assignee ? " is-on" : ""}`}
                onClick={doAssign}
              >
                {assignee ? <Icons.checkCircle /> : <Icons.assign />}
                {assignee ? "Atribuído" : "Atribuir"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={doResolve}>
                {localState === "resolved" ? <Icons.replay /> : <Icons.checkCircle />}
                {localState === "resolved" ? "Reabrir" : "Resolver"}
              </button>
            </div>
          </div>
        </div>

        <div className="tabs">
          <button
            className={`tab${tab === "detalhes" ? " on" : ""}`}
            onClick={() => setTab("detalhes")}
          >
            Detalhes
          </button>
          <button
            className={`tab${tab === "atividade" ? " on" : ""}`}
            onClick={() => setTab("atividade")}
          >
            Atividade<span className="tab-n">{record.activity.length}</span>
          </button>
          <button
            className={`tab${tab === "relacionados" ? " on" : ""}`}
            onClick={() => setTab("relacionados")}
          >
            Relacionados<span className="tab-n">{related.length}</span>
          </button>
        </div>

        {tab === "detalhes" ? (
          <>
            <div className="section">
              <h2>Classificação</h2>
              <div className="fields">
                {fields.map(([label, value, mono]) => (
                  <div className="field" key={label}>
                    <label>{label}</label>
                    <span
                      className={`val${mono ? " mono" : ""}`}
                      style={mono ? { fontSize: 13 } : undefined}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              {record.clusterLabel ? (
                <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-body)" }}>
                  Faz parte da recorrência{" "}
                  <Link
                    href="/recorrencias"
                    className="cite"
                    style={{ fontFamily: "var(--font)" }}
                  >
                    {record.clusterLabel}
                  </Link>
                  .
                </div>
              ) : null}
            </div>

            <div className="section" style={{ borderTop: "1px solid var(--border)" }}>
              <h2>Descrição</h2>
              <div className="field full">
                <span className="val long">{record.description}</span>
              </div>
              <h2 style={{ marginTop: 18 }}>Notas de resolução</h2>
              {inserted ? (
                <div className="resnotes filled">
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                      color: "var(--primary-ink)",
                      marginBottom: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icons.aiSpark size={13} />
                    Rascunho da Aurora, revise antes de salvar
                  </div>
                  {inserted}
                </div>
              ) : record.resolutionNotes ? (
                <div className="resnotes filled">{record.resolutionNotes}</div>
              ) : (
                <div className="resnotes">
                  <span className="placeholder">
                    As notas de resolução aparecerão aqui. Fale com a Aurora (botão no
                    canto) para inserir uma sugestão fundamentada. Você revisa e salva.
                  </span>
                </div>
              )}
              <div style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
                {record.closeCode ? (
                  <div className="field">
                    <label>Close code</label>
                    <span className="val">{record.closeCode}</span>
                  </div>
                ) : null}
                <div className="field">
                  <label>Tags</label>
                  <div style={{ marginTop: 2 }}>
                    {record.tags.length ? (
                      record.tags.map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : tab === "atividade" ? (
          <div className="section">
            <h2>Linha do tempo</h2>
            <div className="activity">
              {record.activity.map((a, i) => (
                <div className="act" key={i}>
                  <Avatar who={a.who} cls={`kind-${a.kind}`} />
                  <div className="act-body">
                    <div className="act-meta">
                      <span className="who">{a.who.name}</span>
                      <span className="when">{a.when}</span>
                    </div>
                    <div className="act-text">{a.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="section">
            <h2>Mesmo serviço ou recorrência</h2>
            {related.length ? (
              <div className="related">
                {related.map((r) => (
                  <div
                    className="rel-row"
                    key={r.number}
                    {...activate(() => peek(r.number), `${r.number} · ${r.short}`)}
                  >
                    <span className="num">{r.number}</span>
                    <span className="rdesc">{r.short}</span>
                    <span
                      className="svc mono"
                      style={{ fontSize: 12, color: "var(--muted)" }}
                    >
                      {r.service}
                    </span>
                    <StateBadge state={r.state} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                Nenhum relacionado.
              </div>
            )}
          </div>
        )}
      </div>

      <CopilotFab record={record} onInsert={doInsert} onCopy={doCopy} />

      {toast ? (
        <div className="toast">
          <Icons.checkCircle size={16} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
//  Floating copilot — Aurora. Animated pipeline trace over the live RAG call.
// ===========================================================================

type StepStatus = "pending" | "run" | "done";

// Each id maps, server-side, to a real OpenRouter model (see SELECTABLE_MODELS
// in the backend). All were smoke-tested end to end before being exposed.
const MODELS = [
  {
    id: "auto",
    name: "Automático",
    desc: "A Aurora escolhe o melhor modelo para cada caso",
  },
  {
    id: "gemini-flash",
    name: "Gemini 2.5 Flash",
    desc: "Rápido e didático, ótimo custo-benefício",
  },
  {
    id: "deepseek-v4",
    name: "DeepSeek V4",
    desc: "Bom equilíbrio entre velocidade e qualidade",
  },
  {
    id: "qwen3-max",
    name: "Qwen3 Max",
    desc: "Raciocínio mais detalhado em vários idiomas",
  },
  {
    id: "claude-haiku",
    name: "Claude Haiku 4.5",
    desc: "Respostas rápidas e bem fundamentadas",
  },
];

function CopilotFab({
  record,
  onInsert,
  onCopy,
}: {
  record: IncidentRecord;
  onInsert: (text: string) => void;
  onCopy: (text: string) => void;
}) {
  const { peek, flashCite, autoSuggestFor, consumeAutoSuggest } = useShell();
  const reduced = usePrefersReducedMotion();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [status, setStatus] = useState<StepStatus[]>(() =>
    Array<StepStatus>(5).fill("pending"),
  );
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [model, setModel] = useState("auto");
  const [modelOpen, setModelOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lastMessage, setLastMessage] = useState("Sugerir resolução para este incidente");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgsRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const curModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const kept = result ? result.candidates.filter((c) => c.keep).length : 0;
  const dropped = result ? result.candidates.length - kept : 0;

  const steps: { title: string; icon: IconComponent; detail: React.ReactNode }[] = [
    {
      title: "Resumir consulta",
      icon: Icons.summarize,
      detail: result ? <span className="q">{result.summary}</span> : null,
    },
    {
      title: "Buscar vizinhos",
      icon: Icons.vectorSearch,
      detail: result
        ? `${result.neighbors} ${result.neighbors === 1 ? "vizinho recuperado" : "vizinhos recuperados"}`
        : null,
    },
    {
      title: "Pós-filtro (LLM)",
      icon: Icons.funnel,
      detail: result
        ? `${kept} mantidos, ${dropped} descartado${dropped === 1 ? "" : "s"}`
        : null,
    },
    {
      title: "Classificar",
      icon: Icons.classify,
      detail: result
        ? result.verdict === "PROCEDENTE"
          ? "é um incidente de verdade"
          : "não é um incidente"
        : null,
    },
    {
      title: "Sugerir",
      icon: Icons.lightbulb,
      detail: result
        ? result.verdict === "IMPROCEDENTE"
          ? "não se aplica"
          : result.noBase
            ? "sem caso parecido ainda"
            : "resolução fundamentada em casos reais"
        : null,
    },
  ];

  useEffect(() => () => clearTimers(), []);

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
  }, [open, modelOpen]);

  function animate() {
    if (reduced) {
      setStatus(steps.map((): StepStatus => "run"));
      return;
    }
    let st: StepStatus[] = steps.map((): StepStatus => "pending");
    st[0] = "run";
    setStatus([...st]);
    let i = 0;
    const tick = () => {
      if (i < steps.length - 1) {
        st = [...st];
        st[i] = "done";
        st[i + 1] = "run";
        setStatus([...st]);
        i++;
        timers.current.push(setTimeout(tick, 480));
      }
    };
    timers.current.push(setTimeout(tick, 520));
  }

  async function run() {
    if (phase === "running") return;
    setPhase("running");
    setResult(null);
    setErrMsg(null);
    setWhy(false);
    setShowSteps(false);
    setSrcOpen(false);
    animate();
    try {
      const res = await api.suggest({
        short_description: record.short,
        description: record.description,
        category: record.category,
        cmdb_ci: record.service,
        priority: Number(record.priority.slice(1)),
        model,
      });
      clearTimers();
      setStatus(steps.map((): StepStatus => "done"));
      setResult(mapSuggest(res));
      setPhase("done");
    } catch (e) {
      clearTimers();
      setErrMsg(
        e instanceof ApiError
          ? e.status === 503
            ? "A IA não está configurada (faltam as chaves no .env do servidor)."
            : e.detail
          : "Não foi possível falar com a Aurora agora.",
      );
      setPhase("error");
    }
  }

  // Send a written message: echo it as the user's bubble, then run the grounded
  // pipeline (the demo always answers from real resolved incidents).
  function submit() {
    const text = draft.trim();
    if (!text || phase === "running") return;
    setLastMessage(text);
    setDraft("");
    run();
  }

  function askDefault() {
    setLastMessage("Sugerir resolução para este incidente");
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

  // Keep the chat scrolled to the newest content.
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [phase, status, why, open, showSteps, srcOpen]);

  const started = phase !== "idle";

  const stepsList = (
    <div className="trace">
      {steps.map((s, i) => (
        <div key={i} className={`step${status[i] !== "pending" ? " appear" : ""}`}>
          <span
            className={`ico ${status[i] === "done" ? "done" : status[i] === "run" ? "run" : "pending"}`}
          >
            {status[i] === "done" ? (
              <Icons.check sw={3} />
            ) : status[i] === "run" ? (
              <Icons.loader sw={2.4} />
            ) : (
              <span className="dot-sm" />
            )}
          </span>
          <span className="lbl">
            <b>{s.title}</b>
            {status[i] !== "pending" && s.detail ? <> · {s.detail}</> : null}
          </span>
        </div>
      ))}
    </div>
  );

  const traceSummary = result?.candidates.length
    ? `Consultei ${result.candidates.length} ${result.candidates.length === 1 ? "caso" : "casos"} para chegar aqui`
    : "Veja como cheguei a esta conclusão";

  const traceBlock =
    phase === "running" ? (
      <div className="think">
        <div className="think-head">
          <Icons.loader size={14} className="spin" />
          Pensando…
        </div>
        {stepsList}
      </div>
    ) : (
      <div className="think done">
        <button
          className={`think-toggle${showSteps ? " open" : ""}`}
          onClick={() => setShowSteps((s) => !s)}
        >
          <Icons.checkCircle size={15} />
          <span className="tt-text">{traceSummary}</span>
          <Icons.chevronDown size={14} />
        </button>
        {showSteps ? stepsList : null}
      </div>
    );

  const sourcesBlock = result?.candidates.length ? (
    <div className="sources cop-reveal" style={{ animationDelay: "220ms" }}>
      <button
        className={`src-toggle${srcOpen ? " open" : ""}`}
        onClick={() => setSrcOpen((s) => !s)}
      >
        <Icons.list size={15} />
        <span className="src-tt">Fontes que a Aurora consultou</span>
        <span className="src-count">{result.candidates.length}</span>
        <Icons.chevronDown size={14} />
      </button>
      {srcOpen ? (
        <div className="cands">
          <div className="src-hint">
            Abra um caso para conferir. O número é a similaridade, de 0 a 1.
          </div>
          {result.candidates.map((c) => (
            <div
              key={c.id}
              className={`cand${c.keep ? "" : " dropped"}`}
              title={c.reason ?? ""}
              {...activate(() => peek(c.id), `${c.id} · ${c.desc}`)}
            >
              <span className="num">{c.id}</span>
              <span className="cdesc">{c.desc}</span>
              <span className="sim" title="Similaridade semântica, de 0 a 1">
                {c.sim.toFixed(2)}
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
    phase === "done" && result ? (
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
                  ? "É um incidente de verdade, mas ainda não há um caso parecido já resolvido para sugerir."
                  : "É um incidente de verdade. A resolução sugerida está abaixo."}
            </div>
          </div>
        </div>

        {result.verdict === "IMPROCEDENTE" || result.noBase ? (
          <div className="improcedente cop-reveal" style={{ animationDelay: "120ms" }}>
            <div className="imp-head">
              {result.verdict === "IMPROCEDENTE" ? <Icons.alert /> : <Icons.inbox />}
              {result.verdict === "IMPROCEDENTE"
                ? "Por que não é um incidente"
                : "Ainda sem um caso parecido"}
            </div>
            {result.verdict === "IMPROCEDENTE"
              ? "É um pedido de autoatendimento — por exemplo, redefinir a senha — e não a falha de um sistema. O melhor caminho é orientar o cliente pelo próprio autoatendimento, sem abrir um incidente técnico."
              : "É um incidente de verdade, mas ainda não temos um caso parecido já resolvido para embasar uma sugestão automática. Resolva manualmente e registre a solução: ela passa a alimentar o copiloto nos próximos casos."}
          </div>
        ) : (
          <>
            {result.suggestion ? (
              <div className="suggestion cop-reveal" style={{ animationDelay: "140ms" }}>
                <h4>Resolução sugerida</h4>
                <SuggestionMarkdown
                  source={result.suggestion}
                  onCite={peek}
                  flashCite={flashCite}
                />
                <div className="sugg-foot">
                  Gerado por <b>{curModel.name}</b>. Fundamentado em casos resolvidos.
                </div>
              </div>
            ) : null}
            {result.suggestion ? (
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
      </>
    ) : phase === "error" ? (
      <div className="improcedente cop-reveal">
        <div className="imp-head">
          <Icons.alert />
          Não consegui responder agora
        </div>
        {errMsg}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={run}>
            <Icons.replay />
            Tentar de novo
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        className={`cop-fab${open ? " hidden" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Falar com a Aurora"
        title="Aurora · assistente de resolução"
      >
        <Icons.aiSpark />
      </button>

      {open ? (
        <div
          className="cop-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Aurora, assistente de resolução"
          tabIndex={-1}
          ref={trapRef}
        >
          <div className="cop-panel-head">
            <span className="cph-mark">
              <Icons.aiSpark />
            </span>
            <div className="cph-title">
              <div className="t">Aurora</div>
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
                      setModel(m.id);
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
                Oi, eu sou a Aurora. Posso sugerir uma resolução para o{" "}
                <b className="mono">{record.number}</b>, com base em incidentes parecidos
                que já foram resolvidos. Sempre mostro as fontes para você conferir.
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
          </div>

          <div className="cop-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escreva uma mensagem para a Aurora…"
              aria-label="Mensagem para a Aurora"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button className="send" onClick={submit} aria-label="Enviar">
              <Icons.send />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
