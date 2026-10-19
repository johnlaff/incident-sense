"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icons } from "@/components/icons";
import { StateBlock } from "@/components/ui";
import { STATE_LABEL, TYPE_LABEL, useChanges, type ChangeSummary } from "@/lib/changes";
import { absDate } from "@/lib/model";

import "./changes.css";

type Tab = "scope" | "all";

export default function ChangesPage() {
  const { data, loading, error } = useChanges();
  const [tab, setTab] = useState<Tab>("scope");

  const rows = useMemo<ChangeSummary[]>(
    () => (data ?? []).filter((c) => tab === "all" || c.in_scope),
    [data, tab],
  );
  const inScope = (data ?? []).filter((c) => c.in_scope).length;

  return (
    <div className="chg-page">
      <div className="page-head chg-head">
        <h1>Changes</h1>
        {data && (
          <span className="count">
            {data.length} mudanças · {inScope} para avaliar
          </span>
        )}
      </div>
      <p className="chg-lede">
        Toda subida em produção vira uma Change. Abra uma e peça a avaliação: o modelo dá
        nota de 0 a 10 a cada campo, contra uma grade versionada, e só confere a coerência
        entre os campos quando o preenchimento chega a 8,0.
      </p>

      <div className="segmented chg-seg" role="tablist" aria-label="Filtrar Changes">
        <button
          role="tab"
          aria-selected={tab === "scope"}
          className={tab === "scope" ? "on" : ""}
          onClick={() => setTab("scope")}
        >
          Para avaliar
        </button>
        <button
          role="tab"
          aria-selected={tab === "all"}
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
        <StateBlock
          variant="error"
          icon={Icons.alert}
          title="Não foi possível carregar as Changes"
        >
          {error}
        </StateBlock>
      )}

      {data && rows.length === 0 && (
        <StateBlock title="Nenhuma Change neste filtro">
          Troque para Todas para ver também as que ficam fora da avaliação.
        </StateBlock>
      )}

      {rows.length > 0 && (
        <ul className="chg-list">
          {rows.map((c) => (
            <li key={c.number}>
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
