// Pure data and geometry for the recurrence demo. No React, no DOM: the page
// and the canvas engine read from here, and tests/recorrencias-model.test.ts
// pins the rules (real incidents only, no overlapping groups, the featured
// group rule, the week buckets).

import type { ClusterPoint, ClustersResponse, IncidentSummary } from "@/lib/types";
import { CLUSTER_HUES, type ClusterTone, clusterTone } from "@/lib/model";
import { keepWhole } from "@/lib/text";

export { keepWhole };

/** The same hues as lib/model.ts clusterColor, so a group keeps its color. */
export const GROUP_HUES = CLUSTER_HUES;

export function groupHue(clusterId: number): number {
  return clusterTone(clusterId).h;
}

/** CSS variables for a group's tone; recorrencias.css .rx-tone picks the theme. */
export function toneVars(tone: ClusterTone): Record<string, number> {
  return {
    "--hue": tone.h,
    "--gl": tone.l,
    "--gc": tone.c,
    "--gdl": tone.dl,
    "--gdc": tone.dc,
  };
}

export interface RecIncident {
  id: string;
  /** Real UMAP coordinates from /api/clusters. */
  x: number;
  y: number;
  clusterId: number;
  isOutlier: boolean;
  short: string;
  priority: number;
  /** From /api/incidents (null if that list did not load). */
  service: string | null;
  openedAt: string | null;
  /** Index into RecData.weeks, or null without a date. */
  week: number | null;
  month: string | null;
}

export interface ServiceCount {
  name: string;
  count: number;
}

export interface RecGroup {
  id: number;
  label: string;
  size: number;
  hue: number;
  tone: ClusterTone;
  /** Indices into RecData.incidents. */
  members: number[];
  services: ServiceCount[];
  /** Share of the group in its most common service (0..1), 0 without data. */
  topShare: number;
  /** Incidents per week, aligned with RecData.weeks. */
  perWeek: number[];
  activeWeeks: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface RecData {
  incidents: RecIncident[];
  /** Real groups, biggest first. */
  groups: RecGroup[];
  /** Indices of HDBSCAN noise points (cluster -1). */
  outliers: number[];
  /** Monday (YYYY-MM-DD) of each week in the data range. */
  weeks: string[];
  /** Months present, "2026-03" style, in order. */
  months: string[];
  services: string[];
  /** The group the lesson highlights (see pickFeatured). */
  featuredId: number | null;
  hasDetails: boolean;
}

const DAY_MS = 86_400_000;

function mondayOf(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return d.getTime() - dow * DAY_MS;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The group worth a Problem first: the biggest one that is mostly one service
 * (80% or more). A group spread over many services is more likely leftovers
 * than one root cause. Without service data, the biggest group.
 */
export function pickFeatured(groups: RecGroup[]): number | null {
  if (groups.length === 0) return null;
  const focused = groups.filter((g) => g.topShare >= 0.8);
  const pool = focused.length > 0 ? focused : groups;
  return pool.reduce((a, b) => (b.size > a.size ? b : a)).id;
}

export function buildRecData(
  clusters: ClustersResponse,
  list: IncidentSummary[] | null,
): RecData {
  const byId = new Map((list ?? []).map((i) => [i.number, i]));
  const dates = clusters.points
    .map((p) => byId.get(p.id)?.opened_at)
    .filter((d): d is string => Boolean(d));
  const weeks: string[] = [];
  let firstMonday = 0;
  if (dates.length > 0) {
    const mondays = dates.map(mondayOf);
    firstMonday = Math.min(...mondays);
    const lastMonday = Math.max(...mondays);
    for (let t = firstMonday; t <= lastMonday; t += 7 * DAY_MS) weeks.push(isoDay(t));
  }
  const months = Array.from(new Set(dates.map((d) => d.slice(0, 7)))).sort();

  const incidents: RecIncident[] = clusters.points.map((p: ClusterPoint) => {
    const s = byId.get(p.id);
    const openedAt = s?.opened_at ?? null;
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      clusterId: p.cluster_id,
      isOutlier: p.is_outlier || p.cluster_id < 0,
      short: p.short_description,
      priority: p.priority,
      service: s?.cmdb_ci ?? null,
      openedAt,
      week: openedAt
        ? Math.round((mondayOf(openedAt) - firstMonday) / (7 * DAY_MS))
        : null,
      month: openedAt ? openedAt.slice(0, 7) : null,
    };
  });

  const groups: RecGroup[] = clusters.clusters
    .filter((c) => c.cluster_id >= 0)
    .map((c) => {
      const members: number[] = [];
      incidents.forEach((inc, idx) => {
        if (!inc.isOutlier && inc.clusterId === c.cluster_id) members.push(idx);
      });
      const svc = new Map<string, number>();
      const perWeek = weeks.map(() => 0);
      const opened: string[] = [];
      for (const idx of members) {
        const inc = incidents[idx];
        if (inc.service) svc.set(inc.service, (svc.get(inc.service) ?? 0) + 1);
        if (inc.week != null) perWeek[inc.week] += 1;
        if (inc.openedAt) opened.push(inc.openedAt);
      }
      opened.sort();
      const services = Array.from(svc, ([name, count]) => ({ name, count })).sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name),
      );
      return {
        id: c.cluster_id,
        label: c.label,
        size: members.length,
        hue: groupHue(c.cluster_id),
        tone: clusterTone(c.cluster_id),
        members,
        services,
        topShare:
          services.length > 0 && members.length > 0
            ? services[0].count / members.length
            : 0,
        perWeek,
        activeWeeks: perWeek.filter((n) => n > 0).length,
        firstAt: opened[0] ?? null,
        lastAt: opened[opened.length - 1] ?? null,
      };
    })
    .filter((g) => g.size > 0)
    .sort((a, b) => b.size - a.size || a.id - b.id);

  const outliers = incidents.flatMap((inc, idx) => (inc.isOutlier ? [idx] : []));
  const services = Array.from(
    new Set(incidents.map((i) => i.service).filter((s): s is string => Boolean(s))),
  ).sort((a, b) => a.localeCompare(b));

  return {
    incidents,
    groups,
    outliers,
    weeks,
    months,
    services,
    featuredId: pickFeatured(groups),
    hasDetails: byId.size > 0,
  };
}

// ----- Filters ----------------------------------------------------------------

export interface RecFilter {
  service: string | null;
  /** "2026-04" style, or null for the whole period. */
  month: string | null;
}

export function matchesFilter(inc: RecIncident, f: RecFilter): boolean {
  if (f.service && inc.service !== f.service) return false;
  if (f.month && inc.month !== f.month) return false;
  return true;
}

// ----- Plain-language reason --------------------------------------------------

const MONTHS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS_PT[m - 1] ?? ym;
}

export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export type Verdict = "problem" | "mixed" | "unknown";

export function verdictOf(g: RecGroup): Verdict {
  if (g.services.length === 0) return "unknown";
  if (g.topShare >= 0.8) return "problem";
  return "mixed";
}

/** One or two short sentences, built only from the group's own numbers. */

export function reasonFor(g: RecGroup, totalWeeks: number, problems = 0): string {
  const v = verdictOf(g);
  const span =
    totalWeeks > 0
      ? `${g.size} casos em ${g.activeWeeks} das ${totalWeeks} semanas`
      : `${g.size} casos`;
  if (v === "problem") {
    const top = g.services[0];
    const all = top.count === g.size;
    const where = `${span}, ${all ? "todos" : `${Math.round(g.topShare * 100)}%`} no ${keepWhole(top.name)}.`;
    // With Problems already open, the list right below says the rest.
    return problems > 0 ? where : `${where} Pede uma investigação de causa.`;
  }
  if (v === "mixed") {
    return `${span}, espalhados por ${g.services.length} serviços. Confira os casos antes de abrir um problema.`;
  }
  return `${span} parecidos. Pedem uma investigação de causa.`;
}

// ----- Plain words per group -------------------------------------------------

/** One or two words for the map, where the full name covers other groups. */
const SHORT_NAMES: Record<string, string> = {
  "Timeout em pagamentos Pix com débito": "Pix",
  "Recusas de cartão por antifraude": "Cartão",
  "Falha de login no app após atualização": "Login no app",
  "Lentidão e erros no Internet Banking": "Banking",
  "Falha na geração de boletos": "Boletos",
  "Divergência entre saldo e extrato": "Saldo e extrato",
  "Consumidor Kafka travado por mensagem malformada": "Kafka",
  "Falhas nas APIs do Open Finance": "Open Finance",
  "Problemas em projetores e cafeteiras": "Projetores",
};

export function shortName(label: string): string {
  return SHORT_NAMES[label] ?? label.split(/\s+/).slice(0, 2).join(" ");
}

/** "mar a jun", or "só em abr" when the group fits in one month. */
export function windowOf(g: RecGroup): string | null {
  if (!g.firstAt || !g.lastAt) return null;
  const a = monthLabel(g.firstAt.slice(0, 7));
  const b = monthLabel(g.lastAt.slice(0, 7));
  return a === b ? `só em ${a}` : `${a} a ${b}`;
}

/** How much of the group is one service: "todos no PIX-Core", "92% no X". */
export function purityOf(g: RecGroup): string | null {
  const top = g.services[0];
  if (!top) return null;
  if (top.count === g.size) return `todos no ${keepWhole(top.name)}`;
  if (g.topShare >= 0.8)
    return `${Math.round(g.topShare * 100)}% no ${keepWhole(top.name)}`;
  return `espalhado em ${g.services.length} serviços`;
}

/** Why these cases sit together, in plain words. */
export function whyTogether(g: RecGroup): string {
  const topic = g.label.charAt(0).toLowerCase() + g.label.slice(1);
  return `A IA juntou estes casos porque os textos são parecidos: falam de ${topic}.`;
}

// ----- Geometry ----------------------------------------------------------------

export interface Disk {
  id: number;
  cx: number;
  cy: number;
  r: number;
}

export interface Layout {
  w: number;
  h: number;
  /** Interleaved x,y per incident (same order as RecData.incidents). */
  scatter: Float32Array;
  grouped: Float32Array;
  disks: Disk[];
  pointR: number;
}

/** Deterministic [0, 1) hash. */
export function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Place every incident in a w x h box.
 *
 * - scatter: an even, jittered pile (the "before"), no meaning in position.
 * - grouped: the groups sit where the real UMAP projection puts them (rotated
 *   to the box's long side, then nudged apart so none overlap). Inside a group
 *   the real points are piled so tight they would hide each other, so they are
 *   spread on a sunflower: the ones closest to the real center stay in the
 *   middle and each keeps roughly its real direction.
 * - outliers keep their real projected position, pushed out of any group.
 */
export function computeLayout(data: RecData, w: number, fullH: number, top = 0): Layout {
  // `top` keeps a strip clear at the top of the box (the tally chip).
  const h = Math.max(1, fullH - top);
  const n = data.incidents.length;
  const scatter = new Float32Array(n * 2);
  const grouped = new Float32Array(n * 2);
  const pad = Math.max(10, Math.min(w, h) * 0.04);

  // Jittered grid for the scatter.
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / Math.max(1, h))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = (w - pad * 2) / cols;
  const ch = (h - pad * 2) / rows;
  const order = data.incidents
    .map((_, i) => i)
    .sort((a, b) => hash01(a * 7 + 1) - hash01(b * 7 + 1));
  order.forEach((idx, k) => {
    const c = k % cols;
    const r = Math.floor(k / cols);
    scatter[idx * 2] = pad + (c + 0.15 + hash01(idx * 5 + 3) * 0.7) * cw;
    scatter[idx * 2 + 1] = pad + (r + 0.15 + hash01(idx * 5 + 11) * 0.7) * ch;
  });

  // Real centroids.
  const cent = data.groups.map((g) => {
    let sx = 0;
    let sy = 0;
    for (const i of g.members) {
      sx += data.incidents[i].x;
      sy += data.incidents[i].y;
    }
    return { x: sx / g.members.length, y: sy / g.members.length };
  });
  const realXs = [
    ...cent.map((c) => c.x),
    ...data.outliers.map((i) => data.incidents[i].x),
  ];
  const realYs = [
    ...cent.map((c) => c.y),
    ...data.outliers.map((i) => data.incidents[i].y),
  ];
  const minX = Math.min(...realXs);
  const maxX = Math.max(...realXs);
  const minY = Math.min(...realYs);
  const maxY = Math.max(...realYs);
  const rotate = maxX - minX >= maxY - minY !== w >= h;
  const project = (x: number, y: number) => {
    const u = (x - minX) / (maxX - minX || 1);
    const v = (y - minY) / (maxY - minY || 1);
    // Rotation by 90 degrees keeps every distance, so the map stays true.
    return rotate ? { u: v, v: 1 - u } : { u, v: 1 - v };
  };

  // Disk sizes: area proportional to members, about a third of the box.
  const total = Math.max(
    1,
    data.groups.reduce((s, g) => s + g.size, 0),
  );
  const scale = Math.sqrt((0.22 * w * h) / (Math.PI * total));
  const radii = data.groups.map((g) => scale * Math.sqrt(g.size));
  const maxR = radii.length ? Math.max(...radii) : 0;
  const inset = pad + maxR * 0.85;
  const disks: Disk[] = data.groups.map((g, k) => {
    const p = project(cent[k].x, cent[k].y);
    return {
      id: g.id,
      cx: inset + p.u * Math.max(1, w - inset * 2),
      cy: inset + p.v * Math.max(1, h - inset * 2),
      r: radii[k],
    };
  });
  const anchors = disks.map((d) => ({ x: d.cx, y: d.cy }));
  const gap = Math.max(14, Math.min(w, h) * 0.06);
  for (let iter = 0; iter < 300; iter++) {
    for (let a = 0; a < disks.length; a++) {
      for (let b = a + 1; b < disks.length; b++) {
        const A = disks[a];
        const B = disks[b];
        let dx = B.cx - A.cx;
        let dy = B.cy - A.cy;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const need = A.r + B.r + gap;
        if (d < need) {
          const push = (need - d) / 2;
          A.cx -= (dx / d) * push;
          A.cy -= (dy / d) * push;
          B.cx += (dx / d) * push;
          B.cy += (dy / d) * push;
        }
      }
    }
    disks.forEach((D, k) => {
      D.cx += (anchors[k].x - D.cx) * 0.01;
      D.cy += (anchors[k].y - D.cy) * 0.01;
      D.cx = Math.min(w - pad - D.r, Math.max(pad + D.r, D.cx));
      D.cy = Math.min(h - pad - D.r, Math.max(pad + D.r, D.cy));
    });
  }

  // Sunflower inside each disk.
  const spacing = scale * Math.sqrt(Math.PI);
  data.groups.forEach((g, k) => {
    const D = disks[k];
    const m = g.members.length;
    const c = D.r / Math.sqrt(m);
    const slots = Array.from({ length: m }, (_, s) => {
      const rr = c * Math.sqrt(s + 0.5);
      const th = s * GOLDEN;
      return {
        x: Math.cos(th) * rr,
        y: Math.sin(th) * rr,
        th: Math.atan2(Math.sin(th), Math.cos(th)),
      };
    });
    const real = g.members
      .map((i) => {
        const inc = data.incidents[i];
        const p = project(inc.x, inc.y);
        const q = project(cent[k].x, cent[k].y);
        const du = p.u - q.u;
        const dv = p.v - q.v;
        return { i, d: Math.hypot(du, dv), th: Math.atan2(dv, du) };
      })
      .sort((a, b) => a.d - b.d || a.i - b.i);
    const free = slots.map((_, s) => s);
    const WINDOW = 8;
    for (const pt of real) {
      let best = 0;
      let bestCost = Infinity;
      for (let j = 0; j < Math.min(WINDOW, free.length); j++) {
        const s = slots[free[j]];
        let dth = Math.abs(s.th - pt.th);
        if (dth > Math.PI) dth = 2 * Math.PI - dth;
        const cost = dth + j * 0.15;
        if (cost < bestCost) {
          bestCost = cost;
          best = j;
        }
      }
      const s = slots[free[best]];
      free.splice(best, 1);
      grouped[pt.i * 2] = D.cx + s.x;
      grouped[pt.i * 2 + 1] = D.cy + s.y;
    }
  });

  // Outliers: real position, outside every disk.
  for (const i of data.outliers) {
    const inc = data.incidents[i];
    const p = project(inc.x, inc.y);
    let x = pad + p.u * (w - pad * 2);
    let y = pad + p.v * (h - pad * 2);
    for (const D of disks) {
      const dx = x - D.cx;
      const dy = y - D.cy;
      const d = Math.hypot(dx, dy) || 1;
      if (d < D.r + gap * 0.6) {
        x = D.cx + (dx / d) * (D.r + gap * 0.6);
        y = D.cy + (dy / d) * (D.r + gap * 0.6);
      }
    }
    grouped[i * 2] = Math.min(w - pad, Math.max(pad, x));
    grouped[i * 2 + 1] = Math.min(h - pad, Math.max(pad, y));
  }

  const pointR = Math.min(5.5, Math.max(2.2, spacing * 0.36));

  // Isolated cases often share a projected spot or land on the same group
  // rim; drawn as is they melt into a smudge. A few separation passes keep
  // each one a readable dot, still near its real place and outside groups.
  const minD = pointR * 2.8;
  const out = data.outliers;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let a = 0; a < out.length; a++) {
      for (let b = a + 1; b < out.length; b++) {
        const ia = out[a] * 2;
        const ib = out[b] * 2;
        let dx = grouped[ib] - grouped[ia];
        let dy = grouped[ib + 1] - grouped[ia + 1];
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-3) {
          // Same spot: split along a fixed, per-pair direction.
          const t = hash01(out[a] * 31 + out[b]) * Math.PI * 2;
          dx = Math.cos(t);
          dy = Math.sin(t);
          d = 1;
        }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        grouped[ia] -= ux * push;
        grouped[ia + 1] -= uy * push;
        grouped[ib] += ux * push;
        grouped[ib + 1] += uy * push;
        moved = true;
      }
    }
    for (const i of out) {
      let x = grouped[i * 2];
      let y = grouped[i * 2 + 1];
      for (const D of disks) {
        const ddx = x - D.cx;
        const ddy = y - D.cy;
        const dd = Math.hypot(ddx, ddy) || 1;
        if (dd < D.r + gap * 0.6) {
          x = D.cx + (ddx / dd) * (D.r + gap * 0.6);
          y = D.cy + (ddy / dd) * (D.r + gap * 0.6);
        }
      }
      grouped[i * 2] = Math.min(w - pad, Math.max(pad, x));
      grouped[i * 2 + 1] = Math.min(h - pad, Math.max(pad, y));
    }
    if (!moved) break;
  }
  if (top > 0) {
    for (let i = 1; i < n * 2; i += 2) {
      scatter[i] += top;
      grouped[i] += top;
    }
    for (const d of disks) d.cy += top;
  }
  return { w, h: fullH, scatter, grouped, disks, pointR };
}

/** Convex hull (monotone chain) of interleaved points picked by `idx`. */
export function convexHull(pos: Float32Array, idx: number[]): number[] {
  const pts = idx
    .map((i) => [pos[i * 2], pos[i * 2 + 1]] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flatMap((p) => [p[0], p[1]]);
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: (readonly number[])[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: (readonly number[])[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].flatMap((p) => [p[0], p[1]]);
}

// ----- Labels --------------------------------------------------------------------

export interface LabelBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the full name did not fit anywhere: show the count only. */
  compact: boolean;
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: typeof a,
  m = 4,
): boolean {
  return (
    a.x < b.x + b.w + m &&
    b.x < a.x + a.w + m &&
    a.y < b.y + b.h + m &&
    b.y < a.y + a.h + m
  );
}

function hitsDisk(
  a: { x: number; y: number; w: number; h: number },
  d: Disk,
  k = 0.62,
): boolean {
  const nx = Math.max(a.x, Math.min(d.cx, a.x + a.w));
  const ny = Math.max(a.y, Math.min(d.cy, a.y + a.h));
  // The rim of a group is sparse; a name may cover it, not the core.
  return Math.hypot(nx - d.cx, ny - d.cy) < d.r * k;
}

/**
 * Put each group's name next to its disk: above, below, right or left, the
 * first spot that stays in the box and clear of other names and groups. If
 * none is free, the label shrinks to its count, centered on the group.
 */
export function placeLabels(
  disks: Disk[],
  sizes: Map<number, { w: number; h: number; cw: number; ch?: number }>,
  w: number,
  h: number,
  opts: {
    compactAll?: boolean;
    full?: number | null;
    onDisk?: boolean;
    /** A box no name may cover (the tally pill in the corner). */
    avoid?: { x: number; y: number; w: number; h: number };
  } = {},
): LabelBox[] {
  const placed: LabelBox[] = [];
  const compactBox = (d: Disk, s: { h: number; cw: number; ch?: number }): LabelBox => {
    const ch = s.ch ?? s.h;
    return {
      id: d.id,
      // Inside the map even when the group touches its edge.
      x: Math.min(w - 4 - s.cw, Math.max(4, d.cx - s.cw / 2)),
      y: Math.min(h - 4 - ch, Math.max(4, d.cy - ch / 2)),
      w: s.cw,
      h: ch,
      compact: true,
    };
  };
  // Narrow maps: every group shows its count on itself; only `full` gets a name.
  const wantsFull = (d: Disk) => !opts.compactAll || opts.full === d.id;
  for (const d of disks) {
    const s = sizes.get(d.id);
    if (s && !wantsFull(d)) placed.push(compactBox(d, s));
  }
  const order = [...disks].filter(wantsFull).sort((a, b) => b.r - a.r);
  for (const d of order) {
    const s = sizes.get(d.id);
    if (!s) continue;
    const g = 4;
    const cands: { x: number; y: number }[] = [
      { x: d.cx - s.w / 2, y: d.cy - d.r - g - s.h },
      { x: d.cx - s.w / 2, y: d.cy + d.r + g },
      { x: d.cx - s.w / 2, y: d.cy - d.r * 0.62 - s.h },
      { x: d.cx - s.w / 2, y: d.cy + d.r * 0.62 },
    ];
    // Name on its own group reads best; the focused one moves off its points.
    if (opts.onDisk && opts.full !== d.id) {
      // Slid inward when the group touches the edge of the map.
      cands.unshift({
        x: Math.min(w - 4 - s.w, Math.max(4, d.cx - s.w / 2)),
        y: Math.min(h - 4 - s.h, Math.max(4, d.cy - s.h / 2)),
      });
    }
    for (const dx of [-0.3, 0.3]) {
      cands.push({ x: d.cx - s.w / 2 + dx * s.w, y: d.cy - d.r - g - s.h });
      cands.push({ x: d.cx - s.w / 2 + dx * s.w, y: d.cy + d.r + g });
    }
    cands.push({ x: d.cx + d.r + g, y: d.cy - s.h / 2 });
    cands.push({ x: d.cx - d.r - g - s.w, y: d.cy - s.h / 2 });
    let chosen: LabelBox | null = null;
    let bestCost = Infinity;
    const others = disks.filter((o) => o.id !== d.id);
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      const box = { id: d.id, x: c.x, y: c.y, w: s.w, h: s.h, compact: false };
      if (box.x < 4 || box.y < 4 || box.x + box.w > w - 4 || box.y + box.h > h - 4)
        continue;
      if (opts.avoid && overlaps(opts.avoid, box)) continue;
      if (placed.some((p) => overlaps(p, box))) continue;
      // Centered on its own group it cannot be mistaken; only another core blocks it.
      const centered = opts.onDisk && opts.full !== d.id && k === 0;
      if (others.some((o) => hitsDisk(box, o, centered ? 0.4 : 0.62))) continue;
      if (centered) {
        chosen = box;
        break;
      }
      // A name over another group's rim reads as that group's: avoid it.
      const cost = k + others.filter((o) => hitsDisk(box, o, 1.1)).length * 20;
      if (cost < bestCost) {
        bestCost = cost;
        chosen = box;
      }
    }
    // Crowded: any spot clear of the other names, even over a group's rim.
    if (!chosen) {
      for (const c of cands) {
        const box = { id: d.id, x: c.x, y: c.y, w: s.w, h: s.h, compact: false };
        if (box.x < 4 || box.y < 4 || box.x + box.w > w - 4 || box.y + box.h > h - 4)
          continue;
        if (opts.avoid && overlaps(opts.avoid, box)) continue;
        if (placed.some((p) => overlaps(p, box))) continue;
        chosen = box;
        break;
      }
    }
    if (!chosen) {
      // Last resort on the group itself, nudged off any name already there.
      const base = compactBox(d, s);
      const step = base.h + 4;
      for (const dy of [0, -step, step, -2 * step, 2 * step]) {
        for (const dx of [0, -base.w / 2, base.w / 2]) {
          const box = {
            ...base,
            x: Math.min(w - 4 - base.w, Math.max(4, base.x + dx)),
            y: Math.min(h - 4 - base.h, Math.max(4, base.y + dy)),
          };
          if (opts.avoid && overlaps(opts.avoid, box)) continue;
          if (!placed.some((p) => overlaps(p, box))) {
            chosen = box;
            break;
          }
        }
        if (chosen) break;
      }
    }
    placed.push(chosen ?? compactBox(d, s));
  }
  return placed;
}

// ----- Easing ---------------------------------------------------------------------

/** --spring-calm from globals.css (M3 standard, no overshoot), sampled. */
const SPRING_CALM = [
  0, 0.025, 0.087, 0.171, 0.264, 0.358, 0.45, 0.535, 0.612, 0.68, 0.739, 0.79, 0.833,
  0.868, 0.897, 0.921, 0.94, 0.955, 0.967, 0.976, 0.984, 0.989, 0.993, 0.996, 1,
];

export function springCalm(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const f = t * (SPRING_CALM.length - 1);
  const i = Math.floor(f);
  return SPRING_CALM[i] + (SPRING_CALM[i + 1] - SPRING_CALM[i]) * (f - i);
}
