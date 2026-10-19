"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icons } from "@/components/icons";
import { useShell } from "@/components/app-shell";
import { LoadError, Meridian, WakeNotice } from "@/components/ui";
import { activate } from "@/lib/a11y";
import { useClusters } from "@/lib/incidents";
import { usePrefersReducedMotion } from "@/lib/motion";
import { clusterColor } from "@/lib/model";
import type { ClustersResponse } from "@/lib/types";

const OUTLIER_GREY = "oklch(0.62 0.012 285)";

interface MapPoint {
  id: string;
  clusterId: number;
  isOutlier: boolean;
  color: string;
  short: string;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

interface MapCluster {
  id: number;
  label: string;
  size: number;
  color: string;
  cx: number;
  cy: number;
}

interface MapView {
  points: MapPoint[];
  clusters: MapCluster[];
  outliers: number;
}

function grand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildView(data: ClustersResponse): MapView {
  const xs = data.points.map((p) => p.x);
  const ys = data.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const nx = (x: number) => 0.06 + ((x - minX) / (maxX - minX || 1)) * 0.88;
  const ny = (y: number) => 0.06 + ((y - minY) / (maxY - minY || 1)) * 0.88;

  const points: MapPoint[] = data.points.map((p, idx) => ({
    id: p.id,
    clusterId: p.cluster_id,
    isOutlier: p.is_outlier,
    color: clusterColor(p.cluster_id, p.is_outlier),
    short: p.short_description,
    tx: nx(p.x),
    ty: ny(p.y),
    sx: 0.1 + grand(idx * 5 + 3) * 0.8,
    sy: 0.12 + grand(idx * 5 + 11) * 0.76,
  }));

  const clusters: MapCluster[] = data.clusters
    .filter((c) => c.cluster_id >= 0)
    .map((c) => {
      // Prefer non-outlier members for the centroid; fall back to all members so
      // a cluster whose points are all outliers doesn't pin its label to (0,0).
      const strict = points.filter((p) => p.clusterId === c.cluster_id && !p.isOutlier);
      const own =
        strict.length > 0 ? strict : points.filter((p) => p.clusterId === c.cluster_id);
      return { c, own };
    })
    .filter(({ own }) => own.length > 0)
    .map(({ c, own }) => ({
      id: c.cluster_id,
      label: c.label,
      size: c.size,
      color: clusterColor(c.cluster_id, false),
      cx: own.reduce((s, p) => s + p.tx, 0) / own.length,
      cy: own.reduce((s, p) => s + p.ty, 0) / own.length,
    }))
    .sort((a, b) => b.size - a.size);

  return { points, clusters, outliers: data.outliers };
}

export default function RecurrencesPage() {
  const { openIncident } = useShell();
  const { data, loading, error, slow, retry } = useClusters();
  const reduced = usePrefersReducedMotion();

  const view = useMemo(() => (data ? buildView(data) : null), [data]);

  const [grouped, setGrouped] = useState(false);
  const [sel, setSel] = useState<number | "outlier" | null>(null);
  const [hover, setHover] = useState<number | "outlier" | null>(null);
  const [promoted, setPromoted] = useState<Record<string, string>>({});
  const [declutter, setDeclutter] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // A link from an incident (?grupo=<id>) opens with that recurrence selected.
  useEffect(() => {
    const grupo = new URLSearchParams(window.location.search).get("grupo");
    if (grupo && /^\d+$/.test(grupo)) setSel(Number(grupo));
  }, []);

  // Fly points from scattered to grouped once the data is in.
  useEffect(() => {
    if (!view) return;
    if (reduced) {
      setGrouped(true);
      return;
    }
    setGrouped(false);
    const t = setTimeout(() => setGrouped(true), 240);
    return () => clearTimeout(t);
  }, [view, reduced]);

  function regroup() {
    if (reduced) {
      setGrouped(true);
      return;
    }
    setGrouped(false);
    setTimeout(() => setGrouped(true), 260);
  }

  // Collision-avoidance: keep every cluster label visible but non-overlapping.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map || !grouped) return;
    const mapR = map.getBoundingClientRect();
    const pad = 8;
    const labels = Array.from(map.querySelectorAll<HTMLElement>(".rmap-label"));
    const ny = new Map<HTMLElement, number>();
    const nx = new Map<HTMLElement, number>();
    labels.forEach((l) => {
      ny.set(l, 0);
      nx.set(l, 0);
      l.style.transition = "none";
      l.style.setProperty("--nudge", "0px");
      l.style.setProperty("--nudge-x", "0px");
    });
    const measure = (l: HTMLElement) => l.getBoundingClientRect();
    const moveY = (l: HTMLElement, dy: number) => {
      const v = (ny.get(l) ?? 0) + dy;
      ny.set(l, v);
      l.style.setProperty("--nudge", `${v}px`);
    };
    const moveX = (l: HTMLElement, dx: number) => {
      const v = (nx.get(l) ?? 0) + dx;
      nx.set(l, v);
      l.style.setProperty("--nudge-x", `${v}px`);
    };

    labels.forEach((l) => {
      const r = measure(l);
      if (r.right > mapR.right - pad) moveX(l, -(r.right - (mapR.right - pad)));
      else if (r.left < mapR.left + pad) moveX(l, mapR.left + pad - r.left);
    });

    for (let iter = 0; iter < 14; iter++) {
      let moved = false;
      const items = labels.map((l) => ({ el: l, r: measure(l) }));
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i].r;
          const b = items[j].r;
          const ox = a.left < b.right + 6 && b.left < a.right + 6;
          const oy = a.top < b.bottom + 4 && b.top < a.bottom + 4;
          if (ox && oy) {
            const half = (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 5) / 2;
            const upper = a.top <= b.top ? items[i] : items[j];
            const lower = upper === items[i] ? items[j] : items[i];
            moveY(upper.el, -half);
            moveY(lower.el, half);
            upper.r = measure(upper.el);
            lower.r = measure(lower.el);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    const rects = labels.map(measure);
    const minTop = Math.min(...rects.map((r) => r.top));
    const maxBot = Math.max(...rects.map((r) => r.bottom));
    let shift = 0;
    if (minTop < mapR.top + pad) shift = mapR.top + pad - minTop;
    else if (maxBot > mapR.bottom - pad) shift = mapR.bottom - pad - maxBot;
    if (shift) labels.forEach((l) => moveY(l, shift));

    void map.offsetHeight;
    labels.forEach((l) => {
      l.style.transition = "";
    });
  }, [grouped, declutter, view]);

  useEffect(() => {
    function onResize() {
      setDeclutter((t) => t + 1);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!grouped) return;
    const t = setTimeout(() => setDeclutter((x) => x + 1), 160);
    if (document.fonts?.ready)
      document.fonts.ready.then(() => setDeclutter((x) => x + 1));
    return () => clearTimeout(t);
  }, [grouped]);

  // When the layout is stacked (map above the list), a group picked on the map
  // opens its detail far below; bring it into view so the tap has a visible result.
  useEffect(() => {
    if (sel == null) return;
    if (!window.matchMedia("(max-width: 1100px)").matches) return;
    detailRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
    });
  }, [sel, reduced]);

  const selIncidents = useMemo(() => {
    if (sel == null || !view) return [];
    const target = sel === "outlier" ? -1 : sel;
    return view.points.filter((p) =>
      sel === "outlier" ? p.isOutlier : p.clusterId === target,
    );
  }, [sel, view]);

  if (error) {
    return (
      <div className="card">
        <LoadError
          title="Não foi possível carregar as recorrências"
          error={error}
          onRetry={retry}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1>Recorrências</h1>
        <span className="count">
          {view
            ? `${view.clusters.length} grupos · ${view.points.length} incidentes`
            : "Carregando…"}
        </span>
      </div>
      <p className="page-lede">
        Cada ponto é um incidente. Os parecidos ficam perto uns dos outros e formam
        grupos: cada grupo é uma recorrência, um padrão que vale investigar. A IA deu nome
        aos grupos. Escolha um para ver os incidentes e abrir um <b>problema</b>.
      </p>
      <WakeNotice show={slow} />

      <div className="rec-layout">
        <div className="card rmap-card">
          <div className="rmap-toolbar">
            <span className="rt-title">Mapa de incidentes</span>
            <span className="rt-sub">Agrupados por semelhança</span>
            <div className="rt-grow" />
            {sel != null ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>
                Mostrar todos
              </button>
            ) : null}
            <button className="btn btn-outline btn-sm" onClick={regroup}>
              <Icons.replay />
              Repetir animação
            </button>
          </div>
          <div className="rmap" ref={mapRef}>
            {loading || !view ? (
              <div className="rmap-loading">Carregando o mapa…</div>
            ) : (
              <>
                {view.points.map((p, idx) => {
                  const active = sel ?? hover;
                  const key = p.isOutlier ? "outlier" : p.clusterId;
                  const dim = active != null && active !== key;
                  const size = p.isOutlier ? 7 : 9;
                  return (
                    <span
                      key={p.id}
                      aria-hidden="true"
                      className={`rmap-point incident${dim ? " dim" : ""}`}
                      style={
                        {
                          "--x": grouped ? p.tx : p.sx,
                          "--y": grouped ? p.ty : p.sy,
                          width: size,
                          height: size,
                          background: p.color,
                          color: p.color,
                          transitionDelay: grouped ? `${(idx % 9) * 20}ms` : "0ms",
                        } as React.CSSProperties
                      }
                      title={`${p.id} · ${p.short}`}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover((h) => (h === key ? null : h))}
                      onClick={() => openIncident(p.id)}
                    />
                  );
                })}
                {grouped
                  ? view.clusters.map((c) => {
                      const active = sel ?? hover;
                      const dim = active != null && active !== c.id;
                      return (
                        <div
                          key={c.id}
                          className={`rmap-label${dim ? " dim" : ""}`}
                          style={{ left: `${c.cx * 100}%`, top: `${c.cy * 100 - 10}%` }}
                          title={c.label}
                          aria-pressed={sel === c.id}
                          onMouseEnter={() => setHover(c.id)}
                          onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                          {...activate(
                            () => setSel(sel === c.id ? null : c.id),
                            `${c.label}, ${c.size} incidentes`,
                          )}
                        >
                          <span className="rl-t">{c.label}</span>
                          <span className="rl-n">{c.size}</span>
                        </div>
                      );
                    })
                  : null}
              </>
            )}
          </div>
        </div>

        <div className="card rec-side">
          <div className="rec-side-list">
            <div className="rec-side-head">
              <h2>Grupos</h2>
              <span>incidentes</span>
            </div>
            <div className="legend">
              {(view?.clusters ?? []).map((c) => (
                <div
                  key={c.id}
                  className={`legend-item${sel === c.id ? " sel" : ""}${hover === c.id ? " hot" : ""}`}
                  aria-pressed={sel === c.id}
                  {...activate(() => setSel(sel === c.id ? null : c.id))}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                >
                  <span className="sw" style={{ background: c.color }} />
                  <span className="lg-label">{c.label}</span>
                  <span className="lg-n">{c.size}</span>
                </div>
              ))}
              {view && view.outliers > 0 ? (
                <div
                  className={`legend-item${sel === "outlier" ? " sel" : ""}${hover === "outlier" ? " hot" : ""}`}
                  aria-pressed={sel === "outlier"}
                  {...activate(() => setSel(sel === "outlier" ? null : "outlier"))}
                  onMouseEnter={() => setHover("outlier")}
                  onMouseLeave={() => setHover((h) => (h === "outlier" ? null : h))}
                >
                  <span className="sw" style={{ background: OUTLIER_GREY }} />
                  <span className="lg-label">Casos isolados</span>
                  <span className="lg-n">{view.outliers}</span>
                </div>
              ) : null}
            </div>
          </div>

          {sel != null && view ? (
            <div className="cluster-detail" ref={detailRef}>
              {(() => {
                const cluster =
                  sel === "outlier" ? null : view.clusters.find((c) => c.id === sel);
                const label =
                  sel === "outlier" ? "Casos isolados" : (cluster?.label ?? "");
                const color =
                  sel === "outlier" ? OUTLIER_GREY : (cluster?.color ?? OUTLIER_GREY);
                const prb = promoted[String(sel)];
                return (
                  <>
                    <h3>
                      <span className="sw" style={{ background: color }} />
                      {label}
                    </h3>
                    <div className="cd-sub">
                      {sel === "outlier"
                        ? `${selIncidents.length} incidentes sem padrão em comum`
                        : `${selIncidents.length} incidentes neste grupo`}
                    </div>
                    <div className="cd-list">
                      {selIncidents.map((x) => (
                        <div
                          className="cd-inc"
                          key={x.id}
                          {...activate(() => openIncident(x.id), `${x.id} · ${x.short}`)}
                        >
                          <span className="num">{x.id}</span>
                          <span className="cdd">{x.short}</span>
                        </div>
                      ))}
                    </div>
                    {sel === "outlier" ? (
                      <p className="cd-note">
                        Casos isolados não viram problema: não se repetem o bastante para
                        indicar um padrão.
                      </p>
                    ) : prb ? (
                      <p className="cd-done" role="status">
                        <Icons.checkCircle size={16} />
                        Problema <span className="mono">{prb}</span> aberto para este
                        grupo
                      </p>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm cd-promote"
                        onClick={() =>
                          setPromoted((m) => ({
                            ...m,
                            [String(sel)]:
                              `PRB00${40210 + (typeof sel === "number" ? sel : 0)}`,
                          }))
                        }
                      >
                        <Icons.promote />
                        Abrir problema
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="cluster-detail">
              <Meridian ticks={14} style={{ marginBottom: 12 }} />
              <p className="cd-note">
                Escolha um grupo no mapa ou nesta lista para ver os incidentes e abrir um
                problema: o registro que investiga a causa de incidentes repetidos.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
