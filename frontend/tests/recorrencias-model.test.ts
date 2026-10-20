import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRecData,
  computeLayout,
  convexHull,
  matchesFilter,
  pickFeatured,
  placeLabels,
  reasonFor,
  springCalm,
} from "@/app/recorrencias/model";
import type { ClustersResponse, IncidentSummary } from "@/lib/types";

// Vitest runs from frontend/; the committed dataset is the source of truth.
const root = `${resolve(process.cwd(), "../backend/data")}/`;
const clusters = JSON.parse(
  readFileSync(`${root}precomputed/clusters.json`, "utf-8"),
) as ClustersResponse;
const raw = JSON.parse(readFileSync(`${root}incidents.json`, "utf-8")) as Array<
  Record<string, unknown>
>;
const list = raw.map(
  (r) =>
    ({
      number: r.number,
      short_description: r.short_description,
      category: r.category,
      cmdb_ci: r.cmdb_ci,
      assignment_group: r.assignment_group,
      priority: r.priority,
      state: r.state,
      opened_at: r.opened_at,
      resolved_at: r.resolved_at,
      is_resolved: false,
      tags: r.tags,
    }) as IncidentSummary,
);

describe("buildRecData on the committed dataset", () => {
  const data = buildRecData(clusters, list);

  it("keeps every real incident, once, with its real group", () => {
    expect(data.incidents).toHaveLength(clusters.points.length);
    const members = data.groups.flatMap((g) => g.members);
    expect(new Set([...members, ...data.outliers]).size).toBe(clusters.points.length);
    for (const g of data.groups) {
      const real = clusters.clusters.find((c) => c.cluster_id === g.id);
      expect(g.size).toBe(real?.size);
    }
  });

  it("sorts groups biggest first and buckets every dated incident in a week", () => {
    const sizes = data.groups.map((g) => g.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    for (const g of data.groups) {
      expect(g.perWeek.reduce((s, n) => s + n, 0)).toBe(g.size);
      expect(g.perWeek).toHaveLength(data.weeks.length);
    }
    expect(data.months).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("features the biggest group that is mostly one service", () => {
    const featured = data.groups.find((g) => g.id === data.featuredId);
    expect(featured?.topShare).toBeGreaterThanOrEqual(0.8);
    const bigger = data.groups.filter((g) => g.size > (featured?.size ?? 0));
    expect(bigger.every((g) => g.topShare < 0.8)).toBe(true);
  });

  it("explains a mixed group without asking for a problem", () => {
    const mixed = data.groups.find((g) => g.topShare < 0.8);
    expect(mixed).toBeDefined();
    expect(reasonFor(mixed!, data.weeks.length)).toMatch(/serviços/);
    expect(reasonFor(mixed!, data.weeks.length)).not.toMatch(/—/);
  });

  it("filters by service and month", () => {
    const inc = data.incidents[0];
    expect(matchesFilter(inc, { service: null, month: null })).toBe(true);
    expect(matchesFilter(inc, { service: "nada", month: null })).toBe(false);
    expect(matchesFilter(inc, { service: inc.service, month: inc.month })).toBe(true);
  });

  for (const [w, h] of [
    [340, 368],
    [900, 560],
    [1500, 760],
  ]) {
    it(`lays out ${w}x${h} with every point in the box and no groups overlapping`, () => {
      const layout = computeLayout(data, w, h);
      for (let i = 0; i < data.incidents.length; i++) {
        for (const arr of [layout.scatter, layout.grouped]) {
          expect(arr[i * 2]).toBeGreaterThanOrEqual(0);
          expect(arr[i * 2]).toBeLessThanOrEqual(w);
          expect(arr[i * 2 + 1]).toBeGreaterThanOrEqual(0);
          expect(arr[i * 2 + 1]).toBeLessThanOrEqual(h);
        }
      }
      for (const a of layout.disks)
        for (const b of layout.disks) {
          if (a.id >= b.id) continue;
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.r + b.r);
        }
      const sizes = new Map(layout.disks.map((d) => [d.id, { w: 160, h: 36, cw: 40 }]));
      const labels = placeLabels(layout.disks, sizes, w, h, { onDisk: true });
      for (const a of labels)
        for (const b of labels) {
          if (a.id >= b.id) continue;
          const apart =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart || a.compact || b.compact).toBe(true);
        }
      // Isolated cases stay readable dots: no two melt into one smudge.
      let closest = Infinity;
      for (let a = 0; a < data.outliers.length; a++)
        for (let b = a + 1; b < data.outliers.length; b++) {
          const ia = data.outliers[a] * 2;
          const ib = data.outliers[b] * 2;
          closest = Math.min(
            closest,
            Math.hypot(
              layout.grouped[ia] - layout.grouped[ib],
              layout.grouped[ia + 1] - layout.grouped[ib + 1],
            ),
          );
        }
      expect(closest).toBeGreaterThanOrEqual(layout.pointR * 2);
    });
  }
});

describe("geometry helpers", () => {
  it("convexHull drops interior points", () => {
    const pos = Float32Array.from([0, 0, 10, 0, 10, 10, 0, 10, 5, 5]);
    expect(convexHull(pos, [0, 1, 2, 3, 4])).toHaveLength(8);
  });

  it("springCalm runs 0 to 1 without overshoot", () => {
    expect(springCalm(0)).toBe(0);
    expect(springCalm(1)).toBe(1);
    for (let t = 0; t < 1; t += 0.05) expect(springCalm(t)).toBeLessThanOrEqual(1);
  });

  it("pickFeatured falls back to the biggest group without service data", () => {
    const data = buildRecData(clusters, null);
    expect(data.hasDetails).toBe(false);
    expect(pickFeatured(data.groups)).toBe(data.groups[0].id);
  });
});
