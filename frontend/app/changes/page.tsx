"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { LoadError, StateBlock, WakeNotice } from "@/components/ui";
import {
  STATE_LABEL,
  TYPE_LABEL,
  readEvalMarks,
  useChanges,
  type ChangeSummary,
  type EvalMark,
} from "@/lib/changes";
import { absDate } from "@/lib/model";

import "./changes.css";
import { keepWhole } from "@/lib/text";

type Tab = "scope" | "all";

export default function ChangesPage() {
  const { data, loading, error, slow, retry } = useChanges();
  const [tab, setTab] = useState<Tab>("scope");
  // Changes evaluated in this session (read after mount: sessionStorage).
  const [marks, setMarks] = useState<Record<string, EvalMark>>({});
  useEffect(() => setMarks(readEvalMarks()), []);

  const rows = useMemo<ChangeSummary[]>(
    () => (data ?? []).filter((c) => tab === "all" || c.in_scope),
    [data, tab],
  );
  const inScope = (data ?? []).filter((c) => c.in_scope).length;

  return (
    <div className="chg-page">
      <div className="page-head">
        <h1>Mudanças</h1>
        {data && (
          <span className="count">
            {data.length} mudanças · {inScope} para avaliar
          </span>
        )}
      </div>
      <p className="page-lede">
        Pedidos para mexer em produção. Abra um e veja a nota da IA.
      </p>
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

      {data && rows.length === 0 && (
        <StateBlock title="Nenhuma mudança neste filtro">
          Escolha <b>Todas</b> para ver também as que ficam fora da avaliação.
        </StateBlock>
      )}

      {rows.length > 0 && (
        <ul className="chg-list">
          {rows.map((c, i) => (
            <li key={c.number} style={{ "--i": i } as CSSProperties}>
              <Link href={`/changes/${c.number}`} className="chg-row">
                <span className="chg-num">
                  <RecordTag number={c.number} size="sm" />
                </span>
                <span className="chg-title">{keepWhole(c.short_description)}</span>
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
                    </span>
                  )}
                  {c.state !== "New" && (
                    <span className="badge chg-state">
                      <span className="dot" />
                      {STATE_LABEL[c.state] ?? c.state}
                    </span>
                  )}
                  {!c.in_scope && (
                    <span className="badge chg-out">
                      <Icons.dot />
                      Fora da avaliação
                    </span>
                  )}
                </span>
                <Icons.chevronRight className="chg-go" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Avaliada · 8,62": the last evaluation of this session, ink, no hue. */
function EvaluatedBadge({ mark }: { mark: EvalMark }) {
  const score =
    mark.overall === null ? "sem nota" : mark.overall.toFixed(2).replace(".", ",");
  return (
    <span
      className="badge chg-evaluated"
      title={mark.passed ? "Passou do corte de 8,0" : "Abaixo do corte de 8,0"}
    >
      <Icons.check />
      Avaliada · {score}
    </span>
  );
}
