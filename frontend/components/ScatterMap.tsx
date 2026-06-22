"use client";

import { useEffect, useRef, useState } from "react";

import { NEW_POINT_COLOR } from "@/lib/colors";
import type { PlotPoint } from "@/lib/plot";

// Minimal structural type for the regl-scatterplot instance methods we use.
interface Scatterplot {
  draw(
    points: number[][],
    opts?: {
      transition?: boolean;
      transitionDuration?: number;
      transitionEasing?: string;
    },
  ): Promise<void>;
  set(props: Record<string, unknown>): void;
  select(indices: number[], opts?: { preventEvent?: boolean }): void;
  deselect(opts?: { preventEvent?: boolean }): void;
  subscribe(event: string, handler: (payload: unknown) => void): unknown;
  getScreenPosition(index: number): [number, number] | undefined;
  destroy(): void;
}

type Line = { x1: number; y1: number; x2: number; y2: number };

export interface ScatterMapProps {
  points: PlotPoint[];
  categoryColors: string[];
  mode: "reveal" | "static";
  /** Bump to replay the reveal animation. */
  revealKey?: number;
  /** Ids of points to emphasize (selected + others dimmed). */
  selectedIds?: string[];
  /** The incoming incident, placed as an extra bright point. */
  newPoint?: { nx: number; ny: number } | null;
  /** Ids of neighbors to draw pulsing lines to from `newPoint`. */
  connectionIds?: string[];
  onHover?: (point: PlotPoint | null) => void;
}

export function ScatterMap({
  points,
  categoryColors,
  mode,
  revealKey = 0,
  selectedIds = [],
  newPoint = null,
  connectionIds = [],
  onHover,
}: ScatterMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spRef = useRef<Scatterplot | null>(null);
  const indexByIdRef = useRef<Map<string, number>>(new Map());
  const newPointIndexRef = useRef<number | null>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const cleanupRef = useRef<(() => void) | null>(null);
  // Always points at the latest recomputeLines so the long-lived 'view' and
  // resize subscriptions don't capture a stale closure (stale connectionIds).
  const recomputeLinesRef = useRef<() => void>(() => undefined);

  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);

  // --- create / destroy the scatterplot ------------------------------------
  useEffect(() => {
    let destroyed = false;
    let sp: Scatterplot | null = null;

    void (async () => {
      const createScatterplot = (await import("regl-scatterplot")).default;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (destroyed || !container || !canvas) return;

      const { width, height } = container.getBoundingClientRect();
      sp = createScatterplot({
        canvas,
        width,
        height,
        pointSize: 5,
      }) as unknown as Scatterplot;

      sp.set({
        colorBy: "category",
        pointColor: [...categoryColors, NEW_POINT_COLOR],
        pointColorActive: [...categoryColors, NEW_POINT_COLOR],
        pointSizeSelected: 9,
        opacityInactiveScale: 0.2,
        lassoColor: [0.22, 0.74, 0.97, 1],
      });

      sp.subscribe("view", () => recomputeLinesRef.current());
      sp.subscribe("pointOver", (payload: unknown) => {
        const idx = payload as number;
        onHoverRef.current?.(pointsRef.current[idx] ?? null);
      });
      sp.subscribe("pointOut", () => onHoverRef.current?.(null));

      spRef.current = sp;
      setReady(true);

      const observer = new ResizeObserver(() => {
        const rect = container.getBoundingClientRect();
        sp?.set({ width: rect.width, height: rect.height });
        recomputeLinesRef.current();
      });
      observer.observe(container);
      cleanupRef.current = () => observer.disconnect();
    })();

    return () => {
      destroyed = true;
      cleanupRef.current?.();
      sp?.destroy();
      spRef.current = null;
      setReady(false);
    };
    // Recreate only on mount; palette/handlers are read from refs/closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- draw points (and the reveal transition) -----------------------------
  useEffect(() => {
    const sp = spRef.current;
    if (!sp || !ready) return;

    const rows: number[][] = points.map((p) => [p.nx, p.ny, p.category, 0]);
    const indexById = new Map<string, number>();
    points.forEach((p, i) => indexById.set(p.id, i));

    if (newPoint) {
      newPointIndexRef.current = rows.length;
      // Category index for the appended "new" color (last slot).
      rows.push([newPoint.nx, newPoint.ny, categoryColors.length, 0]);
    } else {
      newPointIndexRef.current = null;
    }
    indexByIdRef.current = indexById;

    if (mode === "reveal") {
      const scattered = rows.map((r) => [
        Math.random() * 1.8 - 0.9,
        Math.random() * 1.8 - 0.9,
        r[2],
        r[3],
      ]);
      void sp.draw(scattered).then(() =>
        sp.draw(rows, {
          transition: true,
          transitionDuration: 1500,
          transitionEasing: "cubicInOut",
        }),
      );
    } else {
      void sp.draw(rows).then(() => recomputeLines());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, newPoint, revealKey, mode]);

  // --- selection / dimming -------------------------------------------------
  useEffect(() => {
    const sp = spRef.current;
    if (!sp || !ready) return;
    const indices = selectedIds
      .map((id) => indexByIdRef.current.get(id))
      .filter((i): i is number => i !== undefined);
    if (newPointIndexRef.current !== null) indices.push(newPointIndexRef.current);
    if (indices.length) sp.select(indices, { preventEvent: true });
    else sp.deselect({ preventEvent: true });
  }, [ready, selectedIds, newPoint]);

  // --- connection lines overlay --------------------------------------------
  function recomputeLines() {
    const sp = spRef.current;
    const from = newPointIndexRef.current;
    if (!sp || from === null || connectionIds.length === 0) {
      setLines([]);
      return;
    }
    const origin = sp.getScreenPosition(from);
    if (!origin) {
      setLines([]);
      return;
    }
    const next: Line[] = [];
    for (const id of connectionIds) {
      const idx = indexByIdRef.current.get(id);
      if (idx === undefined) continue;
      const target = sp.getScreenPosition(idx);
      if (!target) continue;
      next.push({ x1: origin[0], y1: origin[1], x2: target[0], y2: target[1] });
    }
    setLines(next);
  }
  recomputeLinesRef.current = recomputeLines;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={NEW_POINT_COLOR}
            strokeWidth={1.5}
            className="connection-line"
          />
        ))}
      </svg>
    </div>
  );
}
