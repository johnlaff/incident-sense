"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useAulaLesson, type AulaLessonStep } from "@/components/aula";
import { useShell } from "@/components/app-shell";
import { TechDetails } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { LoadError, WakeNotice } from "@/components/ui";
import { useAllIncidents, useClusters } from "@/lib/incidents";
import { usePrefersReducedMotion } from "@/lib/motion";
import { problemsForGroup, useProblems, type ProblemSummary } from "@/lib/problems";

import { GroupDetail, GroupList } from "./group-panel";
import type { Focus } from "./map-engine";
import {
  buildRecData,
  keepWhole,
  matchesFilter,
  monthLabel,
  type RecFilter,
} from "./model";
import { RecMap } from "./rec-map";

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
      clusters.data && listSettled
        ? buildRecData(clusters.data, list.data?.items ?? null)
        : null,
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
    let last =
      "O grupo que mais se repete num serviço só vira um problema para investigar a causa.";
    if (featured) {
      const top = featured.services[0];
      const where = top
        ? top.count === featured.size
          ? `, todos no ${keepWhole(top.name)}`
          : `, ${Math.round(featured.topShare * 100)}% no ${keepWhole(top.name)}`
        : "";
      last = `${featured.label}: ${featured.size} casos${where}. Vale abrir um problema.`;
      if (featuredProblems.length > 0) {
        const n = featuredProblems.length;
        last = `${featured.label}: ${featured.size} casos${where}. Já ${n === 1 ? "virou um problema" : `virou ${n} problemas`}.`;
      }
    }
    return [
      {
        title: "Pontos",
        caption: `Cada ponto é um incidente do conjunto de dados. Sem análise, são ${n} casos soltos.`,
        durationMs: 700,
      },
      {
        title: "Comparar",
        caption: "A IA compara o texto de cada caso. Os parecidos se aproximam.",
        durationMs: 1500,
      },
      {
        title: "Agrupar",
        caption: "Onde há muitos parecidos, nasce um grupo. Quem sobra é caso isolado.",
        durationMs: 900,
      },
      {
        title: "Nomear",
        caption:
          "A IA dá um nome curto a cada grupo. O número diz quantos casos ele tem.",
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

  // Modo aula: the narrator bar floats over the bottom of the screen. The map
  // takes the height left between its top and the bar (minus the steps), so
  // the whole map sits above the narrator at any window size. On a phone the
  // page first scrolls the toolbar away, so the map gets the screen.
  const fitH = useAulaMapFit(lesson.aula && data != null);

  // Focus: the lesson's last step focuses the featured group; a tap wins.
  const [picked, setPicked] = useState<{ focus: Focus } | null>(null);
  const [filter, setFilter] = useState<RecFilter>({ service: null, month: null });
  const [promoted, setPromoted] = useState<Record<string, boolean>>({});

  // Outside modo aula the map opens already grouped and still, with nothing
  // picked: the ranked list beside it is the answer. "Reproduzir" (or a step)
  // plays the grouping on request.
  const [handPlayed, setHandPlayed] = useState(false);
  const instant = !lesson.aula && !handPlayed;
  const { skip, aula: inAula, done: lessonDone } = lesson;
  useEffect(() => {
    if (data && !inAula && !handPlayed && !lessonDone) skip();
  }, [data, inAula, handPlayed, lessonDone, skip]);

  // ?grupo=<id> (from an incident) opens on the end state, that group focused.
  useEffect(() => {
    if (!data) return;
    const grupo = new URLSearchParams(window.location.search).get("grupo");
    if (!grupo || !/^\d+$/.test(grupo)) return;
    skip();
    setPicked({ focus: Number(grupo) });
  }, [data, skip]);

  const step = lesson.step;
  // Only the lesson in modo aula opens the featured group on its own.
  const focus: Focus = picked
    ? picked.focus
    : lesson.aula && step >= LAST
      ? (data?.featuredId ?? null)
      : null;
  const stage = step <= 0 ? 0 : Math.min(3, step);
  // A group picked by hand needs the groups drawn.
  const effectiveStage = picked && picked.focus != null && stage < 2 ? 3 : stage;

  // On a phone the list sits above the map: when a tap on the map swaps it
  // for a group's detail, keep the map where the finger left it.
  const stageRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  function choose(f: Focus) {
    // A tap mid-lesson outside modo aula ends the show and keeps the choice.
    if (!lesson.aula && !lesson.done) lesson.skip();
    anchor.current = stageRef.current?.getBoundingClientRect().top ?? null;
    setPicked({ focus: f });
  }
  useLayoutEffect(() => {
    const before = anchor.current;
    anchor.current = null;
    const now = stageRef.current?.getBoundingClientRect().top;
    if (before == null || now == null) return;
    const shift = now - before;
    if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: "instant" });
  }, [picked]);

  function replay() {
    setPicked(null);
    setHandPlayed(true);
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
    data?.groups.forEach((g) =>
      out.set(
        g.id,
        g.members.reduce((s, i) => s + mask[i], 0),
      ),
    );
    return out;
  }, [data, mask]);
  const matchedTotal = useMemo(() => mask.reduce((s, v) => s + v, 0), [mask]);
  const filtering = filter.service != null || filter.month != null;

  const focusGroup =
    data && typeof focus === "number"
      ? (data.groups.find((g) => g.id === focus) ?? null)
      : null;

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
    !lesson.aula &&
    current != null &&
    !(step === LAST && picked && picked.focus !== data?.featuredId);

  return (
    <div
      className="rx-page"
      data-fit={fitH != null ? "" : undefined}
      style={
        fitH != null
          ? ({
              "--rx-fit-h": `${fitH.map}px`,
              "--rx-side-h": `${fitH.side}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="page-head">
        <h1>Falhas que se repetem</h1>
        <span className="count">
          {data
            ? `${data.groups.length} grupos · ${data.incidents.length} incidentes`
            : "Carregando…"}
        </span>
      </div>
      <div className="page-lede rx-lede">
        <p>
          Incidentes que se repetem formam grupos. Grupo grande pede um{" "}
          <Link className="prb-inline-link" href="/problemas">
            problema
          </Link>
          : a investigação da causa.
        </p>
        <p className="rx-terms">
          <b>Grupo</b>: casos com texto parecido, que a IA juntou.
          <br />
          <b>Caso isolado</b>: incidente que não se parece o bastante com nenhum outro.
        </p>
      </div>
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
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={lesson.skip}
              >
                Pular para o fim
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
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, service: e.target.value || null }))
                  }
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
                      onClick={() =>
                        setFilter((f) => ({ ...f, month: f.month === m ? null : m }))
                      }
                    >
                      {monthLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rx-stage" ref={stageRef}>
            {data ? (
              <RecMap
                data={data}
                stage={effectiveStage}
                focus={focus}
                mask={mask}
                matched={matched}
                reduced={reduced || instant}
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

          <p className="rx-map-key">
            Cada ponto é um incidente. Perto quer dizer parecido: a posição mostra
            semelhança, e os eixos não têm unidade.
          </p>

          <ol className="rx-steps" aria-label="Etapas da demonstração">
            {steps.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  className={`rx-step${i === step ? " on" : ""}${i < step ? " past" : ""}${
                    STEP_KIND[i] ? ` ${STEP_KIND[i]}` : ""
                  }`}
                  title={
                    STEP_KIND[i] === "ai" ? `${s.title}: etapa feita pela IA` : s.title
                  }
                  aria-current={i === step ? "step" : undefined}
                  disabled={!data}
                  onClick={() => {
                    setPicked(null);
                    setHandPlayed(true);
                    lesson.goTo(i);
                  }}
                >
                  <span className="rx-step-n">{i + 1}</span>
                  <span className="rx-step-t">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
          {/* Nothing reserved when there is nothing to say: no blank gap. */}
          {showCaption || lesson.aula ? (
            <p className="rx-caption" aria-live="polite">
              {showCaption ? current.caption : " "}
            </p>
          ) : null}

          <div className="rx-foot">
            <TechDetails summary="Como o mapa foi feito">
              <p>
                O texto de cada incidente vira um vetor (embedding). O HDBSCAN procura as
                regiões densas desses vetores com distância cosseno: cada região densa é
                um grupo, e quem não cabe em nenhuma vira caso isolado. Um LLM dá o nome
                curto de cada grupo, e o UMAP reduz os vetores a duas dimensões para
                desenhar o mapa.
              </p>
              <p>
                No mapa, a posição de cada grupo vem do UMAP. Dentro do grupo os pontos
                foram espaçados para não se cobrirem: os do centro são os mais próximos do
                meio real do grupo.
              </p>
            </TechDetails>
          </div>
        </div>

        <aside className="card rx-side">
          <div className="rx-side-scroll">
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
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Modo aula sizes (CSS px): the map height that ends the map and its steps
 * above the aula bar, and the side panel height that ends there too, so the
 * group's histogram is not cut on a short screen.
 */
function useAulaMapFit(active: boolean): { map: number; side: number } | null {
  const [h, setH] = useState<{ map: number; side: number } | null>(null);
  useEffect(() => {
    if (!active) {
      setH(null);
      return;
    }
    const phone = window.matchMedia("(max-width: 699.98px)");
    let scrolled = false;
    const fit = () => {
      const map = document.querySelector<HTMLElement>(".rx-map");
      const steps = document.querySelector<HTMLElement>(".rx-steps");
      const bar = document.querySelector<HTMLElement>(".aula-bar");
      const top = document.querySelector<HTMLElement>(".topbar");
      if (!map || !steps || !bar || !top || map.offsetHeight === 0) return;
      const r = map.getBoundingClientRect();
      // Modo aula zooms the app: rects are in screen px, heights in CSS px.
      const zoom = r.height / map.offsetHeight || 1;
      const barTop = bar.getBoundingClientRect().top;
      const stepsH = steps.getBoundingClientRect().height;
      const mapTop = phone.matches
        ? top.getBoundingClientRect().bottom + 8
        : r.top + window.scrollY;
      const avail = (barTop - 12 - stepsH - mapTop) / zoom;
      const side = document.querySelector<HTMLElement>(".rx-side-scroll");
      const sideTop = side ? side.getBoundingClientRect().top : mapTop;
      setH({
        map: Math.max(phone.matches ? 260 : 180, Math.floor(avail)),
        side: Math.max(240, Math.floor((barTop - 12 - sideTop) / zoom)),
      });
      if (phone.matches && !scrolled) {
        scrolled = true;
        const y = r.top + window.scrollY - top.getBoundingClientRect().bottom - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
      }
    };
    const raf = requestAnimationFrame(fit);
    const late = window.setTimeout(fit, 400);
    const bar = document.querySelector<HTMLElement>(".aula-bar");
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    if (bar) ro.observe(bar);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [active]);
  return h;
}
