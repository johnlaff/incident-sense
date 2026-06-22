"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { ScatterMap } from "@/components/ScatterMap";
import { Button } from "@/components/ui/button";
import type { PlotModel } from "@/lib/plot";
import type { ClusterPoint, ClusterSummary } from "@/lib/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Keep labels inside the map (centroids can sit near the edges).
const pctX = (nx: number) => `${clamp(((nx + 1) / 2) * 100, 9, 91)}%`;
const pctY = (ny: number) => `${clamp(((1 - ny) / 2) * 100, 6, 94)}%`;

export function ClusterReveal({
  model,
  clusters,
}: {
  model: PlotModel;
  clusters: ClusterSummary[];
}) {
  const [revealKey, setRevealKey] = useState(0);
  const [hover, setHover] = useState<ClusterPoint | null>(null);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-bg/40">
      <ScatterMap
        points={model.points}
        categoryColors={model.categoryColors}
        mode="reveal"
        revealKey={revealKey}
        onHover={(p) => setHover(p?.source ?? null)}
      />

      {/* AI-generated cluster labels fading in near each cluster. */}
      <div className="pointer-events-none absolute inset-0">
        {model.centroids.map((c, i) => (
          <motion.div
            key={c.clusterId}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: pctX(c.nx), top: pctY(c.ny) }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.7 + i * 0.08, duration: 0.5 }}
          >
            <span
              className="whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium"
              style={{
                borderColor: `${c.color}55`,
                color: c.color,
                background: "rgba(7,11,22,0.62)",
              }}
            >
              {c.label}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="absolute right-4 top-4">
        <Button variant="outline" size="sm" onClick={() => setRevealKey((k) => k + 1)}>
          ↻ Reanimar
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 max-w-[60%] rounded-lg border border-border bg-surface/80 p-3 text-xs backdrop-blur">
        <div className="mb-2 font-medium text-muted">Grupos recorrentes</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {clusters.map((c, i) => (
            <div key={c.cluster_id} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: model.categoryColors[i] }}
              />
              <span className="truncate text-fg">{c.label}</span>
              <span className="ml-auto tabular-nums text-muted">{c.size}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover detail */}
      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute right-4 bottom-4 max-w-xs rounded-lg border border-border bg-surface/90 p-3 text-xs backdrop-blur"
          >
            <div className="font-medium text-accent">{hover.cluster_label}</div>
            <div className="mt-1 text-fg">{hover.short_description}</div>
            <div className="mt-1 text-muted">
              {hover.id} · prioridade {hover.priority}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
