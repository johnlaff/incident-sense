"use client";

// Problem pieces shared by the Problem pages and the shell: the state badge,
// the cause > workaround > fix chain, and the side preview a cited PRB opens
// in place (like a cited incident), so a suggestion never loses its page.

import { useRouter } from "next/navigation";
import { useEffect, type CSSProperties } from "react";

import { RecordTag } from "./concepts";
import { Icons } from "./icons";
import { MetaLine } from "./ui";
import { useFocusTrap, useScrollLock } from "@/lib/a11y";
import {
  PROBLEM_DEFINITION,
  problemState,
  useProblem,
  type ProblemDetail,
} from "@/lib/problems";

import "@/app/problemas/problemas.css";

export function ProblemStateBadge({ state }: { state: string }) {
  const { tone, label } = problemState(state);
  return (
    <span className={`badge prb-badge is-${tone}`}>
      {tone === "resolved" ? <Icons.check sw={3} /> : <span className="dot" />}
      {label}
    </span>
  );
}

export function ProblemDefinition({ className = "" }: { className?: string }) {
  return (
    <p className={`prb-def ${className}`}>
      <Icons.problems />
      {PROBLEM_DEFINITION}
    </p>
  );
}

/** Root cause, then the workaround, then the permanent fix, in that order. */
export function ProblemChain({
  problem,
  className = "",
}: {
  problem: Pick<ProblemDetail, "root_cause" | "workaround" | "permanent_fix" | "state">;
  className?: string;
}) {
  const fixPending = problemState(problem.state).tone === "known";
  const steps = [
    {
      key: "cause",
      icon: Icons.search,
      label: "Causa raiz",
      hint: "Por que os incidentes acontecem.",
      text: problem.root_cause,
    },
    {
      key: "workaround",
      icon: Icons.replay,
      label: "Contorno",
      hint: "O que fazer na hora para o serviço voltar.",
      text: problem.workaround,
    },
    {
      key: "fix",
      icon: Icons.check,
      label: fixPending ? "Solução definitiva (planejada)" : "Solução definitiva",
      hint: fixPending
        ? "Ainda não aplicada: por isso o contorno segue valendo."
        : "O que impede o problema de voltar.",
      text: problem.permanent_fix,
    },
  ];
  return (
    <ol className={`prb-chain ${className}`}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={`prb-step is-${s.key}${s.key === "fix" && fixPending ? " is-pending" : ""}`}
          style={{ "--i": i } as CSSProperties}
        >
          <span className="prb-node" aria-hidden="true">
            <s.icon sw={2.6} />
          </span>
          <div className="prb-step-body">
            <span className="prb-step-label">{s.label}</span>
            <span className="prb-step-hint">{s.hint}</span>
            <p className="prb-step-text">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const PEEK_LINKED = 6;

/** Side preview for a cited Problem; same drawer as a cited incident. */
export function ProblemPeekDrawer({
  number,
  onClose,
  onPeekIncident,
}: {
  number: string;
  onClose: () => void;
  onPeekIncident: (number: string, from?: HTMLElement) => void;
}) {
  const router = useRouter();
  const { data, loading, error } = useProblem(number);
  const trapRef = useFocusTrap<HTMLDivElement>();
  useScrollLock();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linked = data?.related ?? [];

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Problema citado"
        tabIndex={-1}
        ref={trapRef}
      >
        <div className="drawer-head">
          <span className="peek-label">Problema</span>
          <span className="peek-num">
            <RecordTag number={number} />
          </span>
          <button className="drawer-back" onClick={onClose}>
            <Icons.arrowLeft />
            Voltar<span className="drawer-back-long"> à tela anterior</span>
          </button>
        </div>
        <div className="drawer-body">
          {loading ? <p className="muted">Carregando…</p> : null}
          {error ? <p className="peek-error">{error}</p> : null}
          {data ? (
            <>
              <ProblemDefinition />
              <div className="peek-badges">
                <ProblemStateBadge state={data.state} />
              </div>
              <div className="peek-title">
                <h2>{data.short_description}</h2>
                <p>
                  <MetaLine items={[data.cmdb_ci, data.assignment_group]} />
                </p>
              </div>
              <ProblemChain problem={data} className="prb-peek-chain" />
              {linked.length ? (
                <section className="prb-peek-linked">
                  <h3>
                    {linked.length === 1
                      ? "1 incidente ligado"
                      : `${linked.length} incidentes ligados`}
                  </h3>
                  <div className="prb-peek-chips">
                    {linked.slice(0, PEEK_LINKED).map((inc) => (
                      <button
                        type="button"
                        key={inc.number}
                        className="tag-btn"
                        onClick={(e) => onPeekIncident(inc.number, e.currentTarget)}
                        aria-label={`Abrir incidente ${inc.number}: ${inc.short_description}`}
                      >
                        <RecordTag number={inc.number} size="sm" />
                      </button>
                    ))}
                    {linked.length > PEEK_LINKED ? (
                      <span className="more">{`e mais ${linked.length - PEEK_LINKED}`}</span>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <div className="drawer-actions">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    onClose();
                    router.push(`/problemas/${number}`, {
                      transitionTypes: ["nav-forward"],
                    });
                  }}
                >
                  <Icons.external />
                  Abrir problema completo
                </button>
                <button className="btn btn-ghost btn-sm" onClick={onClose}>
                  Voltar
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
