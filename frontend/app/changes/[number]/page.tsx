"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";

import { Icons } from "@/components/icons";
import { StateBlock, WakeNotice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  ADHERENCE_LABEL,
  EVALUATED_FIELDS,
  STATE_LABEL,
  TYPE_LABEL,
  band,
  nota,
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
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Fields edited since the last evaluation: these are the ones the content
  // lock will send back to the model.
  const [dirty, setDirty] = useState<Set<FieldKey>>(new Set());

  const scores = useMemo(() => {
    const map = new Map<FieldKey, FieldScore>();
    result?.fields.forEach((f) => map.set(f.key, f));
    return map;
  }, [result]);

  const inScope = result ? result.scope.in_scope : isInScope(change);
  const valueOf = (key: FieldKey) => edits[key] ?? change[key];

  async function evaluate() {
    setPhase("running");
    setErrMsg(null);
    try {
      const res = await api.evaluateChange(change.number, { fields: edits, model });
      setResult(res);
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

  return (
    <div className="chg-page">
      <nav className="crumbs" aria-label="Trilha">
        <Link href="/changes">Mudanças</Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{change.number}</span>
      </nav>

      <header className="chg-record-head">
        <div className="chg-tags">
          <span className="badge chg-type">{TYPE_LABEL[change.type] ?? change.type}</span>
          <span className="badge chg-state">
            {STATE_LABEL[change.state] ?? change.state}
          </span>
          <span className="badge chg-risk">Risco {change.risk.toLowerCase()}</span>
        </div>
        <h1>{change.short_description}</h1>
        <dl className="chg-facts">
          <div>
            <dt>Serviço</dt>
            <dd className="mono">{change.cmdb_ci}</dd>
          </div>
          <div>
            <dt>Grupo responsável</dt>
            <dd>{change.assignment_group}</dd>
          </div>
          <div>
            <dt>Janela de execução</dt>
            <dd>
              {absDate(change.planned_start)} até {absDate(change.planned_end)}
            </dd>
          </div>
          <div>
            <dt>Empresa</dt>
            <dd>{change.company}</dd>
          </div>
        </dl>
      </header>

      <div className="chg-grid">
        <aside className="chg-aside">
          <section className="card chg-run" aria-labelledby="run-h">
            <h2 id="run-h">Avaliação do preenchimento</h2>
            {!inScope ? (
              <p className="chg-out-note">
                <Icons.alert />
                <span>
                  {result?.scope.reason ?? outOfScopeReason(change)} Ficar sem nota não é
                  o mesmo que tirar nota baixa: esta mudança só não entra nos critérios.
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
                  className="btn btn-primary chg-go-btn"
                  onClick={evaluate}
                  disabled={phase === "running"}
                >
                  {phase === "running" ? (
                    <>
                      <Icons.loader className="spin" />
                      Avaliando 7 campos em paralelo
                    </>
                  ) : (
                    <>
                      <Icons.aiSpark />
                      {result ? "Reavaliar" : "Avaliar preenchimento"}
                    </>
                  )}
                </button>
                {result && dirty.size > 0 && phase !== "running" && (
                  <p className="chg-hint">
                    {dirty.size === 1 ? "1 campo mudou" : `${dirty.size} campos mudaram`}.
                    Só {dirty.size === 1 ? "ele volta" : "eles voltam"} para a IA; os
                    outros mantêm a nota, porque o texto não mudou.
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

            {result && result.overall !== null && <Overall result={result} />}
          </section>

          {result && result.scope.in_scope && <Semantic result={result} />}
        </aside>

        <section className="chg-fields" aria-label="Campos avaliados">
          {orderedFields.map((f) => {
            const score = scores.get(f.key);
            const isDirty = dirty.has(f.key);
            const edited = edits[f.key] !== undefined;
            return (
              <article key={f.key} className="card chg-field">
                <header>
                  <div className="chg-field-title">
                    <h3>{f.label}</h3>
                    <span className="chg-weight">
                      peso {nota(f.weight).replace(",0", "")}
                    </span>
                  </div>
                  {phase === "running" && inScope ? (
                    <span className="chg-score pending" aria-label="Avaliando">
                      <Icons.loader className="spin" />
                    </span>
                  ) : score && !isDirty ? (
                    <span
                      className={`chg-score ${band(score.score)}`}
                      aria-label={`Nota ${nota(score.score)} de 10`}
                    >
                      {nota(score.score)}
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
                  <p className="chg-text">{valueOf(f.key)}</p>
                )}

                {score && !isDirty && editing !== f.key && (
                  <div className="chg-verdict">
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
                      title="O texto não mudou, então a nota foi mantida"
                    >
                      <Icons.check sw={3} />
                      Nota mantida, texto sem mudança
                    </span>
                  )}
                  {isDirty && (
                    <span className="chg-lock dirty">Editado: será reavaliado</span>
                  )}
                  {!isDirty && edited && !score && (
                    <span className="chg-lock dirty">Editado</span>
                  )}
                  {inScope && editing !== f.key && phase !== "running" && (
                    <button
                      className="btn btn-ghost btn-sm chg-edit-btn"
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
            <p className="chg-text">{change.backout_plan}</p>
            <h4>Tarefas cadastradas</h4>
            <ol className="chg-tasks">
              {change.tasks.map((t) => (
                <li key={t.number}>
                  <span className="mono">{t.number}</span>
                  <span>{t.short_description}</span>
                </li>
              ))}
            </ol>
          </article>
        </section>
      </div>
    </div>
  );
}

function Overall({ result }: { result: Evaluation }) {
  const overall = result.overall ?? 0;
  const passed = overall >= result.threshold;
  const reused = result.fields.filter((f) => f.reused).length;
  return (
    <div className="chg-overall">
      <div className="chg-overall-row">
        <span className={`chg-overall-num ${band(overall)}`}>{nota(overall)}</span>
        <span className="chg-overall-label">
          média ponderada
          <br />
          dos 7 campos
        </span>
      </div>
      <div
        className="chg-meter"
        role="img"
        aria-label={`Nota ${nota(overall)} de 10; a coerência só é conferida a partir de ${nota(result.threshold)}`}
      >
        <span className={`fill ${band(overall)}`} style={{ width: `${overall * 10}%` }} />
        <span className="cut" style={{ left: `${result.threshold * 10}%` }}>
          <span>{nota(result.threshold)}</span>
        </span>
      </div>
      <p className={`chg-gate ${passed ? "open" : "closed"}`}>
        {passed ? <Icons.checkCircle /> : <Icons.alert />}
        {passed
          ? `Chegou a ${nota(result.threshold)}: a IA conferiu a coerência entre os campos.`
          : `Abaixo de ${nota(result.threshold)}: a coerência entre os campos não é conferida.`}
      </p>
      <p className="chg-cost">
        {result.model_calls === 0
          ? "Nenhuma chamada à IA"
          : `${result.model_calls} ${result.model_calls === 1 ? "chamada" : "chamadas"} à IA`}
        {reused > 0 && ` · ${reused} ${reused === 1 ? "nota mantida" : "notas mantidas"}`}
        {" · "}
        {(result.duration_ms / 1000).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        })}{" "}
        s{" · "}
        {modelNameFromRoute(result.model)}
        <br />
        Critérios versão {result.rubric_version}
      </p>
    </div>
  );
}

function Semantic({ result }: { result: Evaluation }) {
  const s = result.semantic;
  return (
    <section className="card chg-semantic" aria-labelledby="sem-h">
      <h2 id="sem-h">Coerência entre os campos</h2>
      {!s ? (
        <p className="chg-muted">{result.semantic_skipped_reason}</p>
      ) : (
        <>
          <p className="chg-sub">Os campos contam a mesma história?</p>
          <div className="chg-sem-scores">
            <div>
              <span className={`chg-score ${band(s.consistency_score)}`}>
                {nota(s.consistency_score)}
              </span>
              <span>consistência</span>
            </div>
            <div>
              <span className={`chg-adh ${s.backout_adherence}`}>
                {s.backout_adherence_percent}%
              </span>
              <span>
                plano de retorno x tarefas:{" "}
                {ADHERENCE_LABEL[s.backout_adherence].toLowerCase()}
              </span>
            </div>
          </div>
          {s.problems.length > 0 && (
            <>
              <h3>Incoerências</h3>
              <ul className="chg-problems">
                {s.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Raciocínio</h3>
          <p>{s.reasoning}</p>
          <h3>Orientação ao autor</h3>
          <p>{s.guidance}</p>
          {s.reused && (
            <p className="chg-muted">Conferência mantida: nenhum campo mudou.</p>
          )}
        </>
      )}
    </section>
  );
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
