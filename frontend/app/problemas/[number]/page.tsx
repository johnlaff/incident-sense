"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, ViewTransition } from "react";

import { useShell } from "@/components/app-shell";
import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { ProblemChain, ProblemDefinition, ProblemStateBadge } from "@/components/problem";
import { MetaLine, StateBadge, StateBlock, WakeNotice } from "@/components/ui";
import { activate } from "@/lib/a11y";
import { mapSummary } from "@/lib/model";
import { useProblem, type ProblemDetail } from "@/lib/problems";

import "../problemas.css";
import { keepWhole } from "@/lib/text";

// The linked list starts short so a phone does not scroll through 38 rows.
const LINKED_FIRST = 8;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { dateStyle: "medium" });
}

function Crumbs({ number }: { number: string }) {
  return (
    <nav className="crumbs" aria-label="Você está em">
      <Link href="/problemas" transitionTypes={["nav-back"]}>
        Problemas
      </Link>
      <span aria-hidden="true">/</span>
      <span className="mono" aria-current="page">
        {number}
      </span>
    </nav>
  );
}

export default function ProblemDetailPage() {
  const params = useParams<{ number: string }>();
  const number = params.number;
  const { data, loading, error, errorStatus, slow, retry } = useProblem(number);

  if (loading) {
    return (
      <div className="detail-single prb-page" aria-busy="true">
        <Crumbs number={number} />
        <WakeNotice show={slow} />
        <div className="card record-card">
          <div className="record-head record-skel">
            <ViewTransition name={`prb-${number}`} share="morph" default="none">
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
      <div className="detail-single prb-page">
        <Crumbs number={number} />
        <StateBlock
          icon={Icons.alert}
          variant="error"
          title="Problema não encontrado"
          action={
            <Link href="/problemas" className="btn btn-primary btn-sm">
              Ver todos os problemas
            </Link>
          }
        >
          Não existe um problema com o número {number}. Confira o número ou escolha um na
          lista.
        </StateBlock>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="detail-single prb-page">
        <Crumbs number={number} />
        <StateBlock
          icon={Icons.alert}
          variant="error"
          title="Não foi possível abrir o problema"
          action={
            <div className="state-actions">
              <button className="btn btn-outline btn-sm" onClick={retry}>
                <Icons.replay />
                Tentar de novo
              </button>
              <Link href="/problemas" className="btn btn-ghost btn-sm">
                Voltar para problemas
              </Link>
            </div>
          }
        >
          {error ?? "O servidor não devolveu este problema."}
        </StateBlock>
      </div>
    );
  }

  return <ProblemRecord problem={data} />;
}

function ProblemRecord({ problem }: { problem: ProblemDetail }) {
  const { peek } = useShell();
  const [showAll, setShowAll] = useState(false);
  const linked = problem.related.map(mapSummary);
  const visible = showAll ? linked : linked.slice(0, LINKED_FIRST);

  const fields: [string, string][] = [
    ["Serviço afetado", problem.cmdb_ci],
    ["Categoria", problem.category],
    ["Subcategoria", problem.subcategory],
    ["Grupo", problem.assignment_group],
    ["Empresa", problem.empresa],
    ["Aberto em", day(problem.opened_at)],
  ];
  if (problem.resolved_at) fields.push(["Resolvido em", day(problem.resolved_at)]);

  return (
    <div className="detail-single prb-page">
      <Crumbs number={problem.number} />

      <div className="card record-card">
        <div className="record-head">
          <div className="record-title">
            <div className="row">
              <ViewTransition name={`prb-${problem.number}`} share="morph" default="none">
                <span className="record-num">
                  <RecordTag number={problem.number} size="lg" />
                </span>
              </ViewTransition>
              <ProblemStateBadge state={problem.state} />
            </div>
            <h1>{keepWhole(problem.short_description)}</h1>
            <div className="meta">
              <MetaLine
                items={[
                  problem.cmdb_ci,
                  problem.assignment_group,
                  linked.length === 1 ? "1 incidente" : `${linked.length} incidentes`,
                ]}
              />
            </div>
          </div>
          <ProblemDefinition className="prb-head-def" />
        </div>

        <div className="rec-body prb-body">
          <section className="section rec-desc" aria-labelledby="h-desc">
            <h2 id="h-desc">O que acontece</h2>
            <p className="rec-prose">{problem.description}</p>
          </section>

          <section className="section prb-chain-sec" aria-labelledby="h-chain">
            <h2 id="h-chain">Da causa à solução</h2>
            <ProblemChain problem={problem} />
          </section>

          <section className="section rec-aside" aria-labelledby="h-class">
            <h2 id="h-class">Classificação</h2>
            <dl className="fields">
              {fields.map(([k, v]) => (
                <div className="field" key={k}>
                  <dt>{k}</dt>
                  <dd className="val">{keepWhole(v)}</dd>
                </div>
              ))}
              {problem.cluster_label ? (
                <div className="field full">
                  <dt>Recorrência</dt>
                  <dd className="val">
                    <Link
                      className="rec-link"
                      href={
                        problem.cluster_id != null
                          ? `/recorrencias?grupo=${problem.cluster_id}`
                          : "/recorrencias"
                      }
                    >
                      {problem.cluster_label}
                      <Icons.chevronRight size={14} />
                    </Link>
                  </dd>
                </div>
              ) : null}
              <div className="field full">
                <dt>Tags</dt>
                <dd className="val">
                  {problem.tags.length ? (
                    <span className="tag-list">
                      {problem.tags.map((t) => (
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

          <section className="section prb-linked" aria-labelledby="h-linked">
            <div className="prb-linked-head">
              <h2 id="h-linked">Incidentes ligados</h2>
              <span>{linked.length}</span>
            </div>
            {linked.length ? (
              <>
                <p className="prb-linked-note">
                  Os casos que esta causa raiz explica. Toque em um para ver o incidente.
                </p>
                <div className="related">
                  {visible.map((r) => (
                    <div
                      className="rel-row"
                      key={r.number}
                      {...activate(() => peek(r.number), `${r.number} · ${r.short}`)}
                    >
                      <span className="num">
                        <RecordTag number={r.number} size="sm" />
                      </span>
                      <span className="rdesc">{r.short}</span>
                      <span className="svc">{r.rel}</span>
                      <StateBadge state={r.state} />
                    </div>
                  ))}
                </div>
                {linked.length > visible.length ? (
                  <button
                    className="btn btn-outline btn-sm prb-more"
                    onClick={() => setShowAll(true)}
                  >
                    {`Mostrar todos os ${linked.length}`}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="rel-empty">Nenhum incidente ligado a este problema.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
