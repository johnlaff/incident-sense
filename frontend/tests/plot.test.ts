import { describe, expect, it } from "vitest";

import { buildPlotModel, randomScatter } from "@/lib/plot";
import { OUTLIER_COLOR } from "@/lib/colors";
import type { ClusterPoint, ClustersResponse } from "@/lib/types";

function point(over: Partial<ClusterPoint>): ClusterPoint {
  return {
    id: "INC1",
    x: 0,
    y: 0,
    cluster_id: 0,
    cluster_label: "Grupo",
    is_outlier: false,
    short_description: "desc",
    priority: 3,
    ...over,
  };
}

function sample(): ClustersResponse {
  const points = [
    point({ id: "A", x: 0, y: 0, cluster_id: 0, cluster_label: "Pix" }),
    point({ id: "B", x: 10, y: 10, cluster_id: 0, cluster_label: "Pix" }),
    point({ id: "C", x: 5, y: -5, cluster_id: 1, cluster_label: "Boleto" }),
    point({
      id: "D",
      x: -8,
      y: 8,
      cluster_id: -1,
      cluster_label: "Outliers",
      is_outlier: true,
    }),
  ];
  return { points, clusters: [], total: 4, outliers: 1 };
}

describe("buildPlotModel", () => {
  const model = buildPlotModel(sample());

  it("normalizes coordinates into [-1, 1]", () => {
    for (const p of model.points) {
      expect(p.nx).toBeGreaterThanOrEqual(-1);
      expect(p.nx).toBeLessThanOrEqual(1);
      expect(p.ny).toBeGreaterThanOrEqual(-1);
      expect(p.ny).toBeLessThanOrEqual(1);
    }
  });

  it("gives outliers the grey category color", () => {
    const outlier = model.points.find((p) => p.id === "D");
    expect(outlier?.category).toBe(model.outlierCategory);
    expect(model.categoryColors[model.outlierCategory]).toBe(OUTLIER_COLOR);
  });

  it("computes one centroid per non-outlier cluster", () => {
    expect(model.centroids).toHaveLength(2);
    expect(model.centroids.map((c) => c.label).sort()).toEqual(["Boleto", "Pix"]);
  });
});

describe("randomScatter", () => {
  it("is deterministic for a given seed", () => {
    expect(randomScatter(3, 42)).toEqual(randomScatter(3, 42));
  });
});
