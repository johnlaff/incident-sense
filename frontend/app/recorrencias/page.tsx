"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useAulaLesson, type AulaLessonStep } from "@/components/aula";
import { useShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { LoadError, WakeNotice } from "@/components/ui";
import { useAllIncidents, useClusters } from "@/lib/incidents";
import { usePrefersReducedMotion } from "@/lib/motion";
import { problemsForGroup, useProblems, type ProblemSummary } from "@/lib/problems";

import { GroupDetail, GroupList, PromoteAction } from "./group-panel";
import type { Focus } from "./map-engine";
import { buildRecData, matchesFilter, monthLabel, reasonFor, verdictOf, type RecFilter } from "./model";
import { RecMap } from "./rec-map";
import { GroupTimeline } from "./timeline";

import "../problemas/problemas.css";
import "./recorrencias.css";

const LAST = 4;
/** Concept of each step: the AI compares and names; the last one is a Problem. */
const STEP_KIND = ["", "ai", "", "ai", "prb"];

export default function RecurrencesPage() {
  const { openIncident } = useShell();
  const clusters = useClusters();
  const list = useAllIncidents();
  const reduced = usePrefersReducedMotion();

  // The map waits for the incident list (service and date) a short while; if
  // it fails, the map still plays without the timeline and the filters.
  const listSettled = !list.loading;
  const data = useMemo(
    () =>
      clusters.data && listSettled ? buildRecData(clusters.data, list.data?.items ?? null) : null,
    [clusters.data, list.data, listSettled],
  );

  const featured = data?.groups.find((g) => g.id === data.featuredId) ?? null;

  // Problems already registered per group (their linked incidents fall in it).
  const { data: problemList } = useProblems();
  const problemsByGroup = useMemo(() => {
    const out = new Map<number, ProblemSummary[]>();
    if (!data || !problemList) return out;
    for (const g of data.groups) {
      out.set(
        g.id,
        problemsForGroup(
          problemList,
          g.members.map((i) => data.incidents[i].id),
        ),
      );
    }
    return out;
  }, [data, problemList]);
  const featuredProblems = featured ? (problemsByGroup.get(featured.id) ?? []) : [];

  const steps = useMemo<AulaLessonStep[]>(() => {
    const n = data?.incidents.length ?? 0;
    let last = "O grupo que mais se repete num serviço só vira um problema para investigar a causa.";
    if (featured) {
      const top = featured.services[0];
      const where = top
        ? top.count === featured.size
          ? `, todos no ${top.name}`
          : `, ${Math.round(featured.topShare * 100)}% no ${top.name}`
        : "";
      last = `${featured.label}: ${featured.size} casos${where}. Vale abrir um problema.`;
      if (featuredProblems.length > 0) {
        const n = featuredProblems.length;
        last = `${featured.label}: ${featured.size} casos${where}. Já ${n === 1 ? "virou um problema" : `virou ${n} problemas`}.`;
      }
    }
    return [
      {
        title: "Incidentes",
        caption: `Cada ponto é um incidente real. Sem análise, são ${n} casos soltos.`,
        durationMs: 700,
      },
      {
        title: "Semelhança",
        caption: "A IA compara o texto de cada caso. Os parecidos se aproximam.",
        durationMs: 1500,
      },
      {
        title: "Densidade",
        caption: "Muitos casos parecidos juntos viram um grupo; quem fica sozinho é caso isolado.",
        durationMs: 900,
      },
      {
        title: "Nomes",
        caption: "A IA dá um nome curto a cada grupo. O número diz quantos casos ele tem.",
        durationMs: 900,
      },
      { title: "Problema", caption: last, durationMs: 600 },
    ];
  }, [data, featured, featuredProblems.length]);

  const lesson = useAulaLesson({
    id: "recorrencias",
    steps,
    runKey: data,
    reducedMotion: "finish",
  });

  // Focus: the lesson's last step focuses the featured group; a tap wins.
  const [picked, setPicked] = useState<{ focus: Focus } | null>(null);
  const [filter, setFilter] = useState<RecFilter>({ service: null, month: null });
  const [promoted, setPromoted] = useState<Record<string, boolean>>({});

  // ?grupo=<id> (from an incident) opens on the end state, that group focused.
  const { skip } = lesson;
  useEffect(() => {
    if (!data) return;
    const grupo = new URLSearchParams(window.location.search).get("grupo");
    if (!grupo || !/^\d+$/.test(grupo)) return;
    skip();
    setPicked({ focus: Number(grupo) });
  }, [data, skip]);

  const step = lesson.step;
  const focus: Focus = picked ? picked.focus : step >= LAST ? (data?.featuredId ?? null) : null;
  const stage = step <= 0 ? 0 : Math.min(3, step);
  // A group picked by hand needs the groups drawn.
  const effectiveStage = picked && picked.focus != null && stage < 2 ? 3 : stage;

  function choose(f: Focus) {
    // A tap mid-lesson outside modo aula ends the show and keeps the choice.
    if (!lesson.aula && !lesson.done) lesson.skip();
    setPicked({ focus: f });
  }

  function replay() {
    setPicked(null);
    lesson.replay();
  }

  const mask = useMemo(() => {
    const m = new Uint8Array(data?.incidents.length ?? 0);
    data?.incidents.forEach((inc, i) => {
      m[i] = matchesFilter(inc, filter) ? 1 : 0;
    });
    return m;
  }, [data, filter]);

  const matched = useMemo(() => {
    const out = new Map<number, number>();
    data?.groups.forEach((g) => out.set(g.id, g.members.reduce((s, i) => s + mask[i], 0)));
    return out;
  }, [data, mask]);
  const matchedTotal = useMemo(() => mask.reduce((s, v) => s + v, 0), [mask]);
  const filtering = filter.service != null || filter.month != null;

  const focusGroup =
    data && typeof focus === "number" ? (data.groups.find((g) => g.id === focus) ?? null) : null;

  if (clusters.error) {
    return (
      <div className="card">
        <LoadError
          title="Não foi possível carregar as recorrências"
          error={clusters.error}
          onRetry={clusters.retry}
        />
      </div>
    );
  }

  const current = step >= 0 ? steps[step] : null;
  const showCaption =
    !lesson.aula && current != null && !(step === LAST && picked && picked.focus !== data?.featuredId);

  return (
    <div className="rx-page">
      <div className="page-head">
        <h1>Recorrências</h1>
        <span className="count">
          {data
            ? `${data.groups.length} grupos · ${data.incidents.length} incidentes`
            : "Carregando…"}
        </span>
      </div>
      <p className="page-lede">
        Cada ponto é um incidente. Os parecidos se juntam e formam grupos; um grupo grande
        pede um{" "}
        <Link className="prb-inline-link" href="/problemas">
          problema
        </Link>
        : a investigação da causa.
      </p>
      <WakeNotice show={clusters.slow || list.slow} />

      <div className="rx-layout">
        <div className="card rx-card">
          <div className="rx-toolbar">
            <button
              type="button"
              className="btn btn-primary btn-sm rx-play"
              onClick={replay}
              disabled={!data}
            >
              {lesson.done || step < 0 ? <Icons.replay /> : <Icons.play />}
              Reproduzir
            </button>
            {!lesson.aula && !lesson.done && step >= 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={lesson.skip}>
                Pular
              </button>
            ) : null}
            <div className="rx-grow" />
            {data?.hasDetails ? (
              <div className="rx-filters">
                <label className="rx-sr" htmlFor="rx-svc">
                  Serviço
                </label>
                <select
                  id="rx-svc"
                  className="select rx-select"
                  value={filter.service ?? ""}
                  onChange={(e) => setFilter((f) => ({ ...f, service: e.target.value || null }))}
                >
                  <option value="">Todos os serviços</option>
                  {data.services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="segmented rx-period" role="group" aria-label="Período">
                  <button
                    type="button"
                    className={filter.month == null ? "on" : ""}
                    aria-pressed={filter.month == null}
                    onClick={() => setFilter((f) => ({ ...f, month: null }))}
                  >
                    Tudo
                  </button>
                  {data.months.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={filter.month === m ? "on" : ""}
                      aria-pressed={filter.month === m}
                      onClick={() => setFilter((f) => ({ ...f, month: f.month === m ? null : m }))}
                    >
                      {monthLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rx-stage">
            {data ? (
              <RecMap
                data={data}
                stage={effectiveStage}
                focus={focus}
                mask={mask}
                matched={matched}
                reduced={reduced}
                onFocus={choose}
                onOpenIncident={openIncident}
              />
            ) : (
              <div className="rx-loading">
                <span className="rx-loading-dots" aria-hidden="true" />
                Carregando o mapa…
              </div>
            )}
            {filtering && data ? (
              <div className="rx-filter-note" role="status">
                Mostrando {matchedTotal} de {data.incidents.length}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilter({ service: null, month: null })}
                >
                  Limpar
                </button>
              </div>
            ) : null}
          </div>

          <ol className="rx-steps" aria-label="Etapas da demonstração">
            {steps.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  className={`rx-step${i === step ? " on" : ""}${i < step ? " past" : ""}${
                    STEP_KIND[i] ? ` ${STEP_KIND[i]}` : ""
                  }`}
                  title={STEP_KIND[i] === "ai" ? `${s.title}: etapa feita pela IA` : s.title}
                  aria-current={i === step ? "step" : undefined}
                  disabled={!data}
                  onClick={() => {
                    setPicked(null);
                    lesson.goTo(i);
                  }}
                >
                  <span className="rx-step-n">{i + 1}</span>
                  <span className="rx-step-t">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="rx-caption" aria-live="polite">
            {showCaption ? current.caption : " "}
          </p>

          {data && !focusGroup && effectiveStage >= 3 ? (
            <ul className="rx-legend rx-mobile-only" aria-label="Nomes dos grupos">
              {data.groups.map((g, k) => (
                <li key={g.id} style={{ "--hue": g.hue, "--i": k } as CSSProperties}>
                  <button type="button" onClick={() => choose(g.id)}>
                    <span className="rx-dot" aria-hidden="true" />
                    <span className="rx-legend-t">{g.label}</span>
                    <span className="rx-legend-n">{matched.get(g.id) ?? g.size}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {focusGroup ? (
            <div
              className="rx-strip rx-mobile-only"
              style={{ "--hue": focusGroup.hue } as CSSProperties}
            >
              <div className="rx-strip-h">
                <span className="rx-dot" aria-hidden="true" />
                <b>{focusGroup.label}</b>
                <span>{focusGroup.size} casos</span>
              </div>
              <GroupTimeline key={focusGroup.id} group={focusGroup} weeks={data!.weeks} month={filter.month} compact />
              <p className="rx-reason">{reasonFor(
                  focusGroup,
                  data!.weeks.length,
                  (problemsByGroup.get(focusGroup.id) ?? []).length,
                )}</p>
              <PromoteAction
                verdict={verdictOf(focusGroup)}
                problems={problemsByGroup.get(focusGroup.id) ?? []}
                promoted={Boolean(promoted[String(focusGroup.id)])}
                onPromote={() => setPromoted((m) => ({ ...m, [String(focusGroup.id)]: true }))}
              />
            </div>
          ) : null}

          <p className="rx-foot">
            Posição dos grupos: projeção real dos textos (UMAP). Dentro de cada grupo os pontos foram
            espaçados para não se cobrirem; os do centro são os mais típicos.
          </p>
        </div>

        <aside className="card rx-side">
          {data && focus != null && (focusGroup || focus === "outlier") ? (
            <GroupDetail
              key={String(focus)}
              data={data}
              group={focusGroup ?? "outlier"}
              filter={filter}
              problems={focusGroup ? (problemsByGroup.get(focusGroup.id) ?? []) : []}
              promoted={Boolean(promoted[String(focus)])}
              onPromote={() => setPromoted((m) => ({ ...m, [String(focus)]: true }))}
              onOpenIncident={openIncident}
              onClose={() => setPicked({ focus: null })}
            />
          ) : data ? (
            <GroupList data={data} matched={matched} focus={focus} onFocus={choose} />
          ) : (
            <div className="rx-loading small">Carregando os grupos…</div>
          )}
        </aside>
      </div>
    </div>
  );
}
