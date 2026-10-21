"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import type { ProblemSummary } from "@/lib/problems";
import { keepWhole } from "@/lib/text";

import type { Focus } from "./map-engine";
import { GroupTimeline } from "./timeline";
import {
  matchesFilter,
  purityOf,
  reasonFor,
  toneVars,
  verdictOf,
  whyTogether,
  windowOf,
  type RecData,
  type RecFilter,
  type RecGroup,
} from "./model";

const LIST_STEP = 6;

/** The groups at a glance: a bar per group, sized by its real count. */
export function GroupList({
  data,
  matched,
  focus,
  onFocus,
}: {
  data: RecData;
  matched: Map<number, number>;
  focus: Focus;
  onFocus: (f: Focus) => void;
}) {
  const max = Math.max(1, ...data.groups.map((g) => g.size));
  return (
    <div className="rx-list">
      <div className="rx-list-head">
        <h2>Grupos, do maior para o menor</h2>
        <span>casos</span>
      </div>
      <ul>
        {data.groups.map((g, k) => {
          const m = matched.get(g.id) ?? g.size;
          const sub = [windowOf(g), purityOf(g)].filter(Boolean).join(" · ");
          return (
            <li key={g.id}>
              <button
                type="button"
                className={`rx-row rx-tone${focus === g.id ? " sel" : ""}${m === 0 ? " empty" : ""}`}
                style={
                  {
                    ...toneVars(g.tone),
                    "--v": g.size / max,
                    "--m": m / max,
                    "--i": k,
                  } as CSSProperties
                }
                aria-pressed={focus === g.id}
                onClick={() => onFocus(focus === g.id ? null : g.id)}
              >
                <span className="rx-row-name">
                  <span className="rx-dot" aria-hidden="true" />
                  {g.label}
                </span>
                <span className="rx-row-n">
                  {m === g.size ? g.size : `${m} de ${g.size}`}
                </span>
                {sub ? <span className="rx-row-sub">{sub}</span> : null}
                <span className="rx-row-bar" aria-hidden="true">
                  <span className="rx-row-all" />
                  <span className="rx-row-m" />
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className={`rx-row iso${focus === "outlier" ? " sel" : ""}`}
            style={
              {
                "--v": data.outliers.length / max,
                "--m": data.outliers.length / max,
              } as CSSProperties
            }
            aria-pressed={focus === "outlier"}
            disabled={data.outliers.length === 0}
            onClick={() => onFocus(focus === "outlier" ? null : "outlier")}
          >
            <span className="rx-row-name">Casos isolados</span>
            <span className="rx-row-n">{data.outliers.length}</span>
            <span className="rx-row-sub">não se parecem o bastante com nenhum outro</span>
            <span className="rx-row-bar" aria-hidden="true">
              <span className="rx-row-all" />
            </span>
          </button>
          {data.outliers.length === 0 ? (
            <p className="rx-iso-note">
              Nesta base, nenhum caso ficou sozinho: todos os {data.incidents.length}{" "}
              caíram em algum grupo.
            </p>
          ) : null}
        </li>
      </ul>
    </div>
  );
}

export function GroupDetail({
  data,
  group,
  filter,
  problems,
  allProblems = [],
  promoted,
  onPromote,
  onOpenIncident,
  onClose,
}: {
  data: RecData;
  group: RecGroup | "outlier";
  filter: RecFilter;
  problems: ProblemSummary[];
  /** Every Problem, to say which isolated case is already linked to one. */
  allProblems?: ProblemSummary[];
  promoted: boolean;
  onPromote: () => void;
  onOpenIncident: (id: string) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(LIST_STEP);
  const isGroup = group !== "outlier";
  const members = isGroup ? group.members : data.outliers;
  const rows = members
    .map((i) => data.incidents[i])
    .filter((inc) => matchesFilter(inc, filter));
  const verdict = isGroup ? verdictOf(group) : null;
  const maxSvc = isGroup ? Math.max(1, ...group.services.map((s) => s.count)) : 1;
  const linkedTo = new Map<string, string>();
  if (!isGroup)
    for (const p of allProblems)
      for (const n of p.linked_incidents) linkedTo.set(n, p.number);

  return (
    <section
      className={`rx-detail${isGroup ? " rx-tone" : " rx-iso"}`}
      style={isGroup ? (toneVars(group.tone) as CSSProperties) : undefined}
      aria-label={isGroup ? group.label : "Casos isolados"}
    >
      <div className="rx-detail-top">
        <button type="button" className="btn btn-ghost btn-sm rx-back" onClick={onClose}>
          <Icons.arrowLeft />
          Todos os grupos
        </button>
      </div>
      <h2 className="rx-detail-h">
        <span className="rx-dot" aria-hidden="true" />
        {isGroup ? group.label : "Casos isolados"}
      </h2>
      <p className="rx-detail-n">
        <b>{isGroup ? group.size : data.outliers.length}</b> incidentes
        {isGroup && windowOf(group) ? <span> · {windowOf(group)}</span> : null}
        {isGroup && purityOf(group) ? <span> · {purityOf(group)}</span> : null}
        {rows.length !== members.length ? <span> · {rows.length} no filtro</span> : null}
      </p>
      {isGroup ? <p className="rx-why">{whyTogether(group)}</p> : null}

      {isGroup ? (
        <>
          {problems.length > 0 ? null : verdict === "problem" ? (
            <span className="rx-verdict ok">
              <Icons.promote size={14} />
              Candidato a problema
            </span>
          ) : verdict === "mixed" ? (
            <span className="rx-verdict mixed">
              <Icons.alert size={14} />
              Grupo misturado
            </span>
          ) : null}
          <GroupTimeline group={group} weeks={data.weeks} month={filter.month} />
          {group.services.length > 0 ? (
            <div className="rx-svc">
              <span className="rx-svc-t">Serviços</span>
              <ul>
                {group.services.slice(0, 4).map((s) => (
                  <li key={s.name} style={{ "--v": s.count / maxSvc } as CSSProperties}>
                    <span className="rx-svc-name">{s.name}</span>
                    <span className="rx-svc-n">{s.count}</span>
                    <span className="rx-svc-bar" aria-hidden="true" />
                  </li>
                ))}
                {group.services.length > 4 ? (
                  <li className="rx-svc-more">+ {group.services.length - 4} serviços</li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="rx-reason">
              {reasonFor(group, data.weeks.length, problems.length)}
            </p>
            <PromoteAction
              verdict={verdict}
              groupSize={group.size}
              problems={problems}
              promoted={promoted}
              onPromote={onPromote}
            />
          </div>
        </>
      ) : (
        <p className="rx-reason">
          Caso isolado é um incidente que não se parece o bastante com nenhum outro.
          Sozinho ele não aponta um padrão, mas uma pessoa pode tê-lo ligado a um
          Problema: esses aparecem marcados abaixo.
        </p>
      )}

      <div className="rx-incs">
        <span className="rx-svc-t">Incidentes</span>
        <ul>
          {rows.slice(0, shown).map((inc) => (
            <li key={inc.id}>
              <button
                type="button"
                className="rx-inc"
                onClick={() => onOpenIncident(inc.id)}
              >
                <RecordTag number={inc.id} size="sm" />
                <span className="rx-inc-d">
                  {inc.short}
                  {!isGroup && linkedTo.get(inc.id) ? (
                    <span className="rx-inc-prb">
                      Já ligado ao <span className="mono">{linkedTo.get(inc.id)}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > shown ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShown(rows.length)}
          >
            Mostrar todos os {rows.length}
          </button>
        ) : null}
        {rows.length === 0 ? (
          <p className="rx-reason">Nenhum incidente deste grupo no filtro.</p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A group whose incidents already have Problems links to them; a group with
 * none keeps the simulated "Abrir problema" (nothing is saved).
 */
export function PromoteAction({
  verdict,
  groupSize,
  problems,
  promoted,
  onPromote,
}: {
  verdict: ReturnType<typeof verdictOf> | null;
  /** Incidents in the group, to set beside each Problem's own count. */
  groupSize?: number;
  problems: ProblemSummary[];
  promoted: boolean;
  onPromote: () => void;
}) {
  if (problems.length > 0) {
    return (
      <div className="rec-prb rx-prb">
        <p className="rec-prb-head">
          <Icons.problems size={15} />
          {problems.length === 1
            ? "Este grupo já tem um problema"
            : `Este grupo já tem ${problems.length} problemas`}
        </p>
        <ul className="rec-prb-list">
          {problems.map((p) => (
            <li key={p.number}>
              <Link
                className="rec-prb-row"
                href={`/problemas/${p.number}`}
                transitionTypes={["nav-forward"]}
              >
                <RecordTag number={p.number} size="sm" />
                <span className="rec-prb-title">
                  {keepWhole(p.short_description)}
                  <span className="rec-prb-n">
                    {p.linked_incidents.length} incidentes ligados
                  </span>
                </span>
                <Icons.chevronRight className="prb-go" />
              </Link>
            </li>
          ))}
        </ul>
        {groupSize != null &&
        problems.some((p) => p.linked_incidents.length !== groupSize) ? (
          <p className="rec-prb-note">
            O grupo junta os {groupSize} casos que a IA achou parecidos; o Problema lista
            os que uma pessoa ligou a ele. Por isso os números podem ser diferentes.
          </p>
        ) : null}
      </div>
    );
  }
  if (promoted) {
    return (
      <p className="rx-done" role="status">
        <Icons.checkCircle size={16} />
        Problema aberto para este grupo. É só uma simulação: nenhum Problema é criado.
      </p>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-sm rx-promote ${verdict === "mixed" ? "btn-outline" : "btn-primary"}`}
      onClick={onPromote}
    >
      <Icons.promote />
      Abrir problema
    </button>
  );
}
