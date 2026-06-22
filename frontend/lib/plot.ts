import { clusterColor, OUTLIER_COLOR } from "./colors";
import type { ClusterPoint, ClustersResponse } from "./types";

/** A point ready for regl-scatterplot: coords normalized to [-1, 1] + a color category. */
export interface PlotPoint {
  id: string;
  nx: number;
  ny: number;
  category: number; // index into PlotModel.categoryColors
  source: ClusterPoint;
}

export interface ClusterCentroid {
  clusterId: number;
  label: string;
  nx: number;
  ny: number;
  color: string;
}

export interface PlotModel {
  points: PlotPoint[];
  /** Colors indexed by `category` (clusters in order, then a grey outlier slot). */
  categoryColors: string[];
  centroids: ClusterCentroid[];
  /** category index reserved for outliers. */
  outlierCategory: number;
}

/** Map raw cluster coordinates to a normalized, color-categorized plot model. */
export function buildPlotModel(data: ClustersResponse): PlotModel {
  const xs = data.points.map((p) => p.x);
  const ys = data.points.map((p) => p.y);
  const toNx = scaler(Math.min(...xs), Math.max(...xs));
  const toNy = scaler(Math.min(...ys), Math.max(...ys));

  // Stable cluster ordering -> color index.
  const clusterIds = [
    ...new Set(data.points.filter((p) => !p.is_outlier).map((p) => p.cluster_id)),
  ].sort((a, b) => a - b);
  const categoryOf = new Map(clusterIds.map((id, i) => [id, i]));
  const outlierCategory = clusterIds.length;
  const categoryColors = [...clusterIds.map((_, i) => clusterColor(i)), OUTLIER_COLOR];

  const points: PlotPoint[] = data.points.map((p) => ({
    id: p.id,
    nx: toNx(p.x),
    ny: toNy(p.y),
    category: p.is_outlier
      ? outlierCategory
      : (categoryOf.get(p.cluster_id) ?? outlierCategory),
    source: p,
  }));

  const centroids = computeCentroids(data, toNx, toNy).map((c) => ({
    ...c,
    color: categoryColors[categoryOf.get(c.clusterId) ?? outlierCategory],
  }));
  return { points, categoryColors, centroids, outlierCategory };
}

/** Random scattered positions in [-1, 1], used as the reveal's starting state. */
export function randomScatter(count: number, seed = 7): Array<[number, number]> {
  let state = seed;
  const rng = () => {
    // Small deterministic PRNG so the scatter is stable across renders.
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => [rng() * 1.8 - 0.9, rng() * 1.8 - 0.9]);
}

function scaler(min: number, max: number): (v: number) => number {
  const span = max - min || 1;
  // Map to [-0.92, 0.92] to leave a small margin from the canvas edges.
  return (v: number) => ((v - min) / span) * 1.84 - 0.92;
}

function computeCentroids(
  data: ClustersResponse,
  toNx: (v: number) => number,
  toNy: (v: number) => number,
): Omit<ClusterCentroid, "color">[] {
  const acc = new Map<number, { label: string; sx: number; sy: number; n: number }>();
  for (const p of data.points) {
    if (p.is_outlier) continue;
    const entry = acc.get(p.cluster_id) ?? { label: p.cluster_label, sx: 0, sy: 0, n: 0 };
    entry.sx += toNx(p.x);
    entry.sy += toNy(p.y);
    entry.n += 1;
    acc.set(p.cluster_id, entry);
  }
  return [...acc.entries()].map(([clusterId, e]) => ({
    clusterId,
    label: e.label,
    nx: e.sx / e.n,
    ny: e.sy / e.n,
  }));
}
