"use client";

import Link from "next/link";
import { ViewTransition, type CSSProperties } from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { ProblemDefinition, ProblemStateBadge } from "@/components/problem";
import { LoadError, StateBlock, WakeNotice } from "@/components/ui";
import { problemState, useProblems } from "@/lib/problems";

import "./problemas.css";
import { keepWhole } from "@/lib/text";

export default function ProblemasPage() {
  const { data, loading, error, slow, retry } = useProblems();
  const known = (data ?? []).filter((p) => problemState(p.state).tone === "known").length;

  return (
    <div className="prb-page">
      <div className="page-head">
        <h1>Problemas</h1>
        {data ? (
          <span className="count">
            {`${data.length} problemas · ${known} ${known === 1 ? "erro conhecido" : "erros conhecidos"}`}
          </span>
        ) : null}
      </div>
      <div className="page-lede">
        <ProblemDefinition />
      </div>
      <WakeNotice show={slow} />

      {loading ? (
        <ul className="prb-list" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="prb-row skeleton" />
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="card">
          <LoadError
            title="Não foi possível carregar os problemas"
            error={error}
            onRetry={retry}
          />
        </div>
      ) : null}

      {data && data.length === 0 ? (
        <StateBlock title="Nenhum problema registrado">
          Os problemas aparecem aqui quando a base de exemplo é carregada.
        </StateBlock>
      ) : null}

      {data && data.length > 0 ? (
        <ul className="prb-list">
          {data.map((p, i) => (
            <li key={p.number} style={{ "--i": i } as CSSProperties}>
              <Link
                href={`/problemas/${p.number}`}
                className="prb-row"
                transitionTypes={["nav-forward"]}
              >
                <span className="prb-row-head">
                  <ViewTransition name={`prb-${p.number}`} share="morph" default="none">
                    <span className="prb-num">
                      <RecordTag number={p.number} />
                    </span>
                  </ViewTransition>
                  <ProblemStateBadge state={p.state} />
                </span>
                <span className="prb-title">{keepWhole(p.short_description)}</span>
                <span className="prb-cause">
                  <b>Causa raiz:</b> {p.root_cause}
                </span>
                <span className="prb-meta">
                  <span className="mono">{p.cmdb_ci}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {p.linked_incidents.length === 1
                      ? "1 incidente ligado"
                      : `${p.linked_incidents.length} incidentes ligados`}
                  </span>
                </span>
                <Icons.chevronRight className="prb-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
