// Vivid, well-separated hues for clusters on the dark background.
export const CLUSTER_PALETTE = [
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#60a5fa", // blue
  "#f87171", // red
  "#4ade80", // green
  "#c084fc", // purple
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#facc15", // yellow
];

/** Greyed-out color for HDBSCAN outliers (cluster id -1). */
export const OUTLIER_COLOR = "#475569";

/** Bright color for the incoming incident in the RAG neighbor flight. */
export const NEW_POINT_COLOR = "#ffffff";

export function clusterColor(index: number): string {
  return CLUSTER_PALETTE[index % CLUSTER_PALETTE.length];
}
