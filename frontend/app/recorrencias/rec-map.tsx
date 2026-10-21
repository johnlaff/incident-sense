"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { PRIORITY_LABEL, pCode } from "@/lib/model";
import { keepWhole } from "@/lib/text";

import { MapEngine, type Focus, type Scene } from "./map-engine";
import {
  computeLayout,
  placeLabels,
  shortDate,
  shortName,
  toneVars,
  type LabelBox,
  type RecData,
} from "./model";

interface Props {
  data: RecData;
  stage: number;
  focus: Focus;
  mask: Uint8Array;
  /** Matching incidents per group (filters applied). */
  matched: Map<number, number>;
  reduced: boolean;
  onFocus: (f: Focus) => void;
  onOpenIncident: (id: string) => void;
}

function readPalette() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    dark: root.getAttribute("data-theme") === "dark",
    ink: cs.getPropertyValue("--ink").trim() || "#222",
    surface: cs.getPropertyValue("--surface").trim() || "#fff",
  };
}

function motionScale(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--motion-scale"),
  );
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function RecMap({
  data,
  stage,
  focus,
  mask,
  matched,
  reduced,
  onFocus,
  onOpenIncident,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const labelRefs = useRef(new Map<number, HTMLButtonElement>());
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [labels, setLabels] = useState<LabelBox[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const layout = useMemo(
    () => (size ? computeLayout(data, size.w, size.h, 34) : null),
    [data, size],
  );

  // Engine lifetime.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new MapEngine(canvas);
    engineRef.current = engine;
    engine.setPalette(readPalette());
    const mo = new MutationObserver(() => engine.setPalette(readPalette()));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      mo.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Box size.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New data: start from the scattered pile.
  const dataSeen = useRef<RecData | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !layout || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dataSeen.current !== data) {
      engine.setLayout(layout, size.w, size.h, dpr);
      engine.setData(data, layout);
      dataSeen.current = data;
    } else {
      engine.setLayout(layout, size.w, size.h, dpr);
    }
    setTick((t) => t + 1);
  }, [data, layout, size]);

  // Scene.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !layout) return;
    const scene: Scene = { stage, focus, mask };
    engine.setScene(scene, { reduced, scale: motionScale() });
  }, [stage, focus, mask, reduced, layout, tick]);

  useEffect(() => {
    engineRef.current?.setHover(pinned ?? hover);
  }, [hover, pinned]);

  // Drop a pinned preview the filters or focus have hidden.
  const shown = pinned ?? hover;
  const shownHidden =
    shown != null &&
    (!mask[shown] ||
      (focus != null &&
        (focus === "outlier"
          ? !data.incidents[shown].isOutlier
          : data.incidents[shown].clusterId !== focus)));

  // Labels: measure, then place clear of each other.
  useLayoutEffect(() => {
    if (!layout) return;
    const sizes = new Map<number, { w: number; h: number; cw: number; ch: number }>();
    // Measure every label at full size, before the compact class comes back.
    // React only rewrites className when it changes, so put it back after.
    const had = new Set<HTMLElement>();
    labelRefs.current.forEach((el) => {
      if (el.classList.contains("compact")) had.add(el);
      el.classList.remove("compact");
    });
    labelRefs.current.forEach((el, id) => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // The fallback still names the group: its short name and count.
      el.classList.add("compact");
      sizes.set(id, { w, h, cw: el.offsetWidth, ch: el.offsetHeight });
      el.classList.remove("compact");
    });
    had.forEach((el) => el.classList.add("compact"));
    setLabels(
      placeLabels(layout.disks, sizes, layout.w, layout.h, {
        // A focused group keeps its name; the others shrink to their counts.
        // On a phone the focused one stays a count too: a full name there
        // covers the groups around it, and the caption already names it.
        // Short names on every group; on a wide map the focused one says it all.
        compactAll: false,
        onDisk: true,
        full: typeof focus === "number" && layout.w >= 560 ? focus : null,
        // Clear of the "9 grupos · 78 casos isolados" pill in the corner.
        avoid: { x: 0, y: 0, w: 240, h: 38 },
      }),
    );
  }, [layout, data, focus]);
  const narrow = (size?.w ?? 999) < 560;
  const fullId = typeof focus === "number" && !narrow ? focus : null;

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  function local(e: ReactPointerEvent) {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  }

  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType !== "mouse") return;
    const engine = engineRef.current;
    if (!engine) return;
    const p = local(e);
    setHover(engine.hitPoint(p.x, p.y, 10));
  }

  function onTap(e: ReactPointerEvent<HTMLCanvasElement>) {
    const engine = engineRef.current;
    if (!engine) return;
    const p = local(e);
    const reach = e.pointerType === "mouse" ? 10 : 16;
    const idx = engine.hitPoint(p.x, p.y, reach);
    if (idx != null) {
      const inc = data.incidents[idx];
      setPinned(idx);
      onFocus(inc.isOutlier ? "outlier" : inc.clusterId);
      return;
    }
    setPinned(null);
    onFocus(engine.hitGroup(p.x, p.y));
  }

  const preview = shown != null && !shownHidden && layout ? data.incidents[shown] : null;
  // Previews only open on a resting map, so the target position is the point's.
  const at = layout ? (stage >= 1 ? layout.grouped : layout.scatter) : null;
  const pp =
    preview && shown != null && at ? { x: at[shown * 2], y: at[shown * 2 + 1] } : null;
  const group =
    preview && !preview.isOutlier
      ? data.groups.find((g) => g.id === preview.clusterId)
      : null;

  // A tapped point opens its card under the map, never over it.
  const docked = pinned != null;
  let cardStyle: CSSProperties | undefined;
  if (pp && size && !docked) {
    const cw = Math.min(280, size.w - 24);
    const left = Math.min(size.w - cw - 12, Math.max(12, pp.x - cw / 2));
    const above = pp.y > size.h * 0.5;
    cardStyle = above
      ? { left, width: cw, bottom: size.h - pp.y + 14 }
      : { left, width: cw, top: pp.y + 14 };
  }

  const card =
    preview && (docked || cardStyle) ? (
      <div
        className={`rx-peek${docked ? " pinned docked" : ""}${group ? " rx-tone" : " rx-iso"}`}
        style={
          {
            ...(cardStyle ?? {}),
            ...(group ? toneVars(group.tone) : { "--hue": 265 }),
          } as CSSProperties
        }
        role={docked ? "dialog" : "tooltip"}
        aria-label={`${preview.id}: ${preview.short}`}
      >
        <div className="rx-peek-top">
          <RecordTag number={preview.id} size="sm" />
          <span className="rx-peek-p">{PRIORITY_LABEL[pCode(preview.priority)]}</span>
          {docked ? (
            <button
              type="button"
              className="rx-peek-x"
              aria-label="Fechar prévia"
              onClick={() => setPinned(null)}
            >
              <Icons.close size={14} />
            </button>
          ) : null}
        </div>
        <p className="rx-peek-d">{preview.short}</p>
        <div className="rx-peek-meta">
          {preview.service ? <span>{keepWhole(preview.service)}</span> : null}
          {preview.openedAt ? <span>{shortDate(preview.openedAt)}</span> : null}
          <span className="rx-peek-g">{group ? group.label : "Caso isolado"}</span>
        </div>
        {docked ? (
          <button
            type="button"
            className="btn btn-outline btn-sm rx-peek-open"
            onClick={() => onOpenIncident(preview.id)}
          >
            Abrir incidente
            <Icons.arrowRight />
          </button>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <div className="rx-map" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="rx-canvas"
          role="img"
          aria-label={`Mapa com ${data.incidents.length} incidentes em ${data.groups.length} grupos. A lista de grupos ao lado tem os mesmos dados.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onPointerUp={onTap}
        />
        <p
          className={`rx-tally${stage >= 2 ? " on" : ""}`}
          aria-hidden={stage >= 2 ? undefined : true}
        >
          <b>{data.groups.length}</b> grupos · <b>{data.outliers.length}</b>{" "}
          {data.outliers.length === 1 ? "caso isolado" : "casos isolados"}
        </p>
        <div className={`rx-labels${stage >= 3 ? " on" : ""}`}>
          {data.groups.map((g, k) => {
            const box = labelById.get(g.id);
            const m = matched.get(g.id) ?? g.size;
            const dim = (focus != null && focus !== g.id) || m === 0;
            return (
              <button
                key={g.id}
                type="button"
                ref={(el) => {
                  if (el) labelRefs.current.set(g.id, el);
                  else labelRefs.current.delete(g.id);
                }}
                className={`rx-label rx-tone${box?.compact ? " compact" : ""}${dim ? " dim" : ""}${focus === g.id ? " sel" : ""}`}
                style={
                  {
                    ...toneVars(g.tone),
                    "--i": k,
                    translate: box ? `${box.x}px ${box.y}px` : "-9999px 0",
                  } as CSSProperties
                }
                tabIndex={stage >= 3 ? 0 : -1}
                aria-hidden={stage >= 3 ? undefined : true}
                aria-pressed={focus === g.id}
                aria-label={`${g.label}: ${m === g.size ? g.size : `${m} de ${g.size}`} incidentes`}
                title={g.label}
                onClick={() => {
                  setPinned(null);
                  onFocus(focus === g.id ? null : g.id);
                }}
              >
                <span className="rx-label-dot" aria-hidden="true" />
                <span className="rx-label-name">
                  {fullId === g.id ? g.label : shortName(g.label)}
                </span>
                <span className="rx-label-short">{shortName(g.label)}</span>
                <span className="rx-label-n">
                  {m === g.size ? g.size : `${m}/${g.size}`}
                </span>
              </button>
            );
          })}
        </div>

        {card && !docked ? card : null}
      </div>
      {card && docked ? card : null}
    </>
  );
}
