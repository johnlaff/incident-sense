"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import { Icons } from "@/components/icons";
import { LoadError, StateBlock, WakeNotice } from "@/components/ui";
import { STATE_LABEL, TYPE_LABEL, useChanges, type ChangeSummary } from "@/lib/changes";
import { absDate } from "@/lib/model";

import "./changes.css";

type Tab = "scope" | "all";

export default function ChangesPage() {
  const { data, loading, error, slow, retry } = useChanges();
  const [tab, setTab] = useState<Tab>("scope");

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
        Toda alteração em produção é registrada como uma mudança (a Change do ServiceNow).
        Abra uma e peça a avaliação: a IA dá nota de 0 a 10 a cada campo, seguindo
        critérios fixos, e só confere se os campos contam a mesma história quando a média
        chega a 8,0.
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
                <span className="chg-num">{c.number}</span>
                <span className="chg-title">{c.short_description}</span>
                <span className="chg-meta">
                  <span className="mono">{c.cmdb_ci}</span>
                  <span aria-hidden="true">·</span>
                  <span>{absDate(c.planned_start)}</span>
                </span>
                <span className="chg-tags">
                  <span className="badge chg-type">{TYPE_LABEL[c.type] ?? c.type}</span>
                  <span className="badge chg-state">
                    {STATE_LABEL[c.state] ?? c.state}
                  </span>
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
