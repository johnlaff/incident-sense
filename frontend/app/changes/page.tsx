"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { LoadError, StateBlock, WakeNotice } from "@/components/ui";
import {
  STATE_HINT,
  STATE_LABEL,
  TYPE_HINT,
  TYPE_LABEL,
  plainTitle,
  readEvalMarks,
  useChanges,
  type ChangeSummary,
  type EvalMark,
} from "@/lib/changes";
import { absDate } from "@/lib/model";

import "./changes.css";
import { keepWhole } from "@/lib/text";

// "Para avaliar" holds what still needs a reading; a Change evaluated in this
// browser tab moves to "Avaliadas" (the marks live in sessionStorage).
type Tab = "scope" | "done" | "all";

export default function ChangesPage() {
  const { data, loading, error, slow, retry } = useChanges();
  const [tab, setTab] = useState<Tab>("scope");
  // Changes evaluated in this session (read after mount: sessionStorage).
  const [marks, setMarks] = useState<Record<string, EvalMark>>({});
  useEffect(() => setMarks(readEvalMarks()), []);

  const rows = useMemo<ChangeSummary[]>(
    () =>
      (data ?? []).filter((c) =>
        tab === "all"
          ? true
          : tab === "done"
            ? Boolean(marks[c.number])
            : c.in_scope && !marks[c.number],
      ),
    [data, tab, marks],
  );
  const toEvaluate = (data ?? []).filter((c) => c.in_scope && !marks[c.number]).length;
  const evaluated = (data ?? []).filter((c) => marks[c.number]).length;
  // The three numbers add up to the total: none is left unexplained.
  const outOfScope = (data ?? []).filter((c) => !c.in_scope && !marks[c.number]).length;

  return (
    <div className="chg-page">
      <div className="page-head">
        <h1>Mudanças</h1>
      </div>
      <p className="page-lede">
        A IA dá uma nota de 0 a 10 a cada pedido e diz se pode seguir.
      </p>
      <p className="chg-scope-note">
        Só entram pedidos comuns, não urgentes, ainda não analisados e do próprio banco.
      </p>
      {data && (
        <p className="chg-counts">
          <b>{data.length} mudanças:</b> {toEvaluate} para avaliar · {evaluated}{" "}
          {evaluated === 1 ? "avaliada" : "avaliadas"} · {outOfScope} fora do escopo da IA
        </p>
      )}
      <WakeNotice show={slow} />

      <div className="segmented chg-seg" role="group" aria-label="Filtrar mudanças">
        <button
          aria-pressed={tab === "scope"}
          className={tab === "scope" ? "on" : ""}
          onClick={() => setTab("scope")}
        >
          Para avaliar
        </button>
        <button
          aria-pressed={tab === "done"}
          className={tab === "done" ? "on" : ""}
          onClick={() => setTab("done")}
        >
          Avaliadas{evaluated > 0 ? ` · ${evaluated}` : ""}
        </button>
        <button
          aria-pressed={tab === "all"}
          className={tab === "all" ? "on" : ""}
          onClick={() => setTab("all")}
        >
          Todas
        </button>
      </div>

      {loading && (
        <ul className="chg-list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="chg-row skeleton" />
          ))}
        </ul>
      )}

      {error && (
        <div className="card">
          <LoadError
            title="Não foi possível carregar as mudanças"
            error={error}
            onRetry={retry}
          />
        </div>
      )}

      {data && rows.length === 0 && tab === "done" && (
        <StateBlock title="Nenhuma mudança avaliada ainda">
          Abra uma em <b>Para avaliar</b> e peça a nota da IA. Ela fica aqui enquanto esta
          aba do navegador estiver aberta.
        </StateBlock>
      )}
      {data && rows.length === 0 && tab !== "done" && (
        <StateBlock title="Nenhuma mudança para avaliar">
          As que você avaliou estão em <b>Avaliadas</b>. Escolha <b>Todas</b> para ver
          também as que ficam fora do escopo da IA.
        </StateBlock>
      )}

      {rows.length > 0 && (
        <ul className="chg-list">
          {rows.map((c, i) => {
            // The plain line leads; the technical title follows, smaller.
            const lead = plainTitle(c.plain);
            return (
              <li key={c.number} style={{ "--i": i } as CSSProperties}>
                <Link href={`/changes/${c.number}`} className="chg-row">
                  <span className="chg-num">
                    <RecordTag number={c.number} size="sm" />
                  </span>
                  {lead ? (
                    <>
                      <span className="chg-title">{lead}</span>
                      <span className="chg-row-plain tech">
                        {keepWhole(c.short_description)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="chg-title">{keepWhole(c.short_description)}</span>
                      {c.plain ? <span className="chg-row-plain">{c.plain}</span> : null}
                    </>
                  )}
                  <span className="chg-meta">
                    <span>{keepWhole(c.cmdb_ci)}</span>
                    <span>{absDate(c.planned_start)}</span>
                  </span>
                  {/* Only what varies: almost every Change is Normal and Nova,
                    so those words show up only on the one that is not. */}
                  <span className="chg-tags">
                    {marks[c.number] ? <EvaluatedBadge mark={marks[c.number]} /> : null}
                    <span className="badge chg-risk">
                      <span className="dot" />
                      Risco {c.risk.toLowerCase()}
                    </span>
                    {c.type !== "Normal" && (
                      <span className="badge chg-type">
                        <span className="dot" />
                        {TYPE_LABEL[c.type] ?? c.type}
                        {TYPE_HINT[c.type] ? ` (${TYPE_HINT[c.type]})` : ""}
                      </span>
                    )}
                    {c.state !== "New" && (
                      <span className="badge chg-state">
                        <span className="dot" />
                        {STATE_LABEL[c.state] ?? c.state}
                        {STATE_HINT[c.state] ? ` (${STATE_HINT[c.state]})` : ""}
                      </span>
                    )}
                    {!c.in_scope && (
                      <span className="badge chg-out">
                        <Icons.dot />
                        Fora do escopo da IA
                      </span>
                    )}
                  </span>
                  <Icons.chevronRight className="chg-go" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Pode seguir · 8,62": the verdict of this session's last evaluation. */
function EvaluatedBadge({ mark }: { mark: EvalMark }) {
  const score =
    mark.overall === null ? "sem nota" : mark.overall.toFixed(2).replace(".", ",");
  // Marks saved before the verdict existed only know the cut.
  const ok = mark.ok ?? mark.passed;
  return (
    <span
      className={`badge chg-evaluated ${ok ? "ok" : "no"}`}
      title={ok ? "A IA recomenda seguir para aprovação" : "A IA recomenda não seguir"}
    >
      {ok ? <Icons.check /> : <Icons.alert />}
      {ok ? "Pode seguir" : "Não segue"} · {score}
    </span>
  );
}
