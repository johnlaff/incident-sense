// Canvas 2D renderer for the recurrence map. One canvas, one rAF loop that
// only runs while something moves, typed arrays for positions. React owns the
// state; this class owns the pixels.

import { convexHull, springCalm, type Layout, type RecData } from "./model";

export type Focus = number | "outlier" | null;

export interface Scene {
  /** 0 scatter (grey) · 1 gathered (grey) · 2 colored + hulls · 3 + names. */
  stage: number;
  focus: Focus;
  /** 1 = matches the filters, per incident. */
  mask: Uint8Array;
}

export interface Palette {
  dark: boolean;
  ink: string;
  surface: string;
}

interface Tween {
  from: number;
  to: number;
  t0: number;
  dur: number;
}

const RAMP = 12;

function tweenValue(tw: Tween, now: number, ease: (t: number) => number): number {
  if (tw.dur <= 0) return tw.to;
  const t = (now - tw.t0) / tw.dur;
  if (t <= 0) return tw.from;
  if (t >= 1) return tw.to;
  return tw.from + (tw.to - tw.from) * ease(t);
}

export class MapEngine {
  private ctx: CanvasRenderingContext2D;
  private data: RecData | null = null;
  private layout: Layout | null = null;
  private palette: Palette = { dark: false, ink: "#222", surface: "#fff" };
  private dpr = 1;

  // Positions: current, start, target (interleaved x,y) and per point timing.
  private cur = new Float32Array(0);
  private from = new Float32Array(0);
  private to = new Float32Array(0);
  private t0 = new Float64Array(0);
  private dur = new Float32Array(0);
  private alpha = new Float32Array(0);
  private alphaTarget = new Float32Array(0);
  private groupOf = new Int16Array(0);

  private color: Tween = { from: 0, to: 0, t0: 0, dur: 0 };
  private hull: Tween = { from: 0, to: 0, t0: 0, dur: 0 };
  private hullFocus = new Map<number, Tween>();
  private ramps = new Map<number, string[]>();
  private tints = new Map<number, string>();
  private grey = "";
  private stage = 0;
  private focus: Focus = null;
  private hover: number | null = null;
  private raf = 0;
  private busyUntil = 0;
  private lastFrame = 0;
  private fade: { snap: HTMLCanvasElement; t0: number; dur: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
  }

  setData(data: RecData, layout: Layout): void {
    const n = data.incidents.length;
    this.data = data;
    this.layout = layout;
    this.cur = Float32Array.from(layout.scatter);
    this.from = Float32Array.from(layout.scatter);
    this.to = Float32Array.from(layout.scatter);
    this.t0 = new Float64Array(n);
    this.dur = new Float32Array(n);
    this.alpha = new Float32Array(n).fill(1);
    this.alphaTarget = new Float32Array(n).fill(1);
    this.groupOf = new Int16Array(n);
    const rank = new Map(data.groups.map((g, k) => [g.id, k]));
    data.incidents.forEach((inc, i) => {
      this.groupOf[i] = inc.isOutlier ? -1 : (rank.get(inc.clusterId) ?? -1);
    });
    this.stage = 0;
    this.color = { from: 0, to: 0, t0: 0, dur: 0 };
    this.hull = { from: 0, to: 0, t0: 0, dur: 0 };
    this.buildColors();
    this.kick(0);
  }

  /** New box size: snap to the new positions of the current stage. */
  setLayout(layout: Layout, w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (!this.data) {
      this.layout = layout;
      return;
    }
    this.layout = layout;
    const target = this.stage >= 1 ? layout.grouped : layout.scatter;
    this.cur.set(target);
    this.from.set(target);
    this.to.set(target);
    this.dur.fill(0);
    this.kick(0);
  }

  setPalette(p: Palette): void {
    this.palette = p;
    this.buildColors();
    this.kick(0);
  }

  private buildColors(): void {
    const L = this.palette.dark ? 0.76 : 0.6;
    this.grey = `oklch(${L} 0.012 265)`;
    this.ramps.clear();
    this.tints.clear();
    for (const g of this.data?.groups ?? []) {
      const ramp: string[] = [];
      for (let k = 0; k < RAMP; k++) {
        const t = k / (RAMP - 1);
        ramp.push(`oklch(${L} ${(0.012 + (0.14 - 0.012) * t).toFixed(3)} ${g.hue})`);
      }
      this.ramps.set(g.id, ramp);
      this.tints.set(
        g.id,
        this.palette.dark ? `oklch(0.31 0.04 ${g.hue})` : `oklch(0.955 0.028 ${g.hue})`,
      );
    }
  }

  setScene(scene: Scene, opts: { reduced: boolean; scale: number }): void {
    const data = this.data;
    const layout = this.layout;
    if (!data || !layout) return;
    const now = performance.now();
    const { reduced, scale } = opts;
    const prevStage = this.stage;
    const stageChanged = scene.stage !== prevStage;
    const focusChanged = scene.focus !== this.focus;

    if (reduced && (stageChanged || focusChanged)) this.snapshot(now);

    // Positions.
    const wantGrouped = scene.stage >= 1;
    const wasGrouped = prevStage >= 1;
    if (wantGrouped !== wasGrouped) {
      const target = wantGrouped ? layout.grouped : layout.scatter;
      const base = 1050 * scale;
      for (let i = 0; i < data.incidents.length; i++) {
        this.from[i * 2] = this.cur[i * 2];
        this.from[i * 2 + 1] = this.cur[i * 2 + 1];
        this.to[i * 2] = target[i * 2];
        this.to[i * 2 + 1] = target[i * 2 + 1];
        if (reduced) {
          this.dur[i] = 0;
          this.cur[i * 2] = target[i * 2];
          this.cur[i * 2 + 1] = target[i * 2 + 1];
        } else {
          // Group by group, with a little jitter so it reads as a flock.
          const g = this.groupOf[i];
          const lag = wantGrouped
            ? (g < 0 ? 9 : g) * 45 + this.jitter(i) * 220
            : this.jitter(i) * 160;
          this.t0[i] = now + lag * scale;
          this.dur[i] = base;
        }
      }
      this.busyUntil = Math.max(this.busyUntil, now + (base + 9 * 45 + 220) * scale);
    }

    // Color and hulls.
    const colorOn = scene.stage >= 2 ? 1 : 0;
    const explain = 560 * scale;
    const cNow = tweenValue(this.color, now, springCalm);
    if (colorOn !== this.color.to) {
      this.color = { from: cNow, to: colorOn, t0: now, dur: reduced ? 0 : explain };
      const hNow = tweenValue(this.hull, now, springCalm);
      this.hull = {
        from: hNow,
        to: colorOn,
        t0: now + (colorOn && !reduced ? explain * 0.35 : 0),
        dur: reduced ? 0 : explain,
      };
      this.busyUntil = Math.max(this.busyUntil, now + explain * 1.4);
    }

    // Focus emphasis per hull.
    for (const g of data.groups) {
      const want = scene.focus == null ? 1 : scene.focus === g.id ? 1 : 0.22;
      const tw = this.hullFocus.get(g.id);
      const curV = tw ? tweenValue(tw, now, springCalm) : 1;
      if (!tw || tw.to !== want) {
        this.hullFocus.set(g.id, {
          from: curV,
          to: want,
          t0: now,
          dur: reduced ? 0 : 320 * scale,
        });
      }
    }
    this.busyUntil = Math.max(this.busyUntil, now + 340 * scale);

    // Per point opacity: filters, focus, isolated cases.
    for (let i = 0; i < data.incidents.length; i++) {
      const inc = data.incidents[i];
      let a = 1;
      if (scene.stage >= 2 && inc.isOutlier) a = 0.5;
      if (scene.focus != null) {
        const mine =
          scene.focus === "outlier"
            ? inc.isOutlier
            : !inc.isOutlier && inc.clusterId === scene.focus;
        if (!mine) a = Math.min(a, 0.18);
      }
      if (!scene.mask[i]) a = Math.min(a, 0.1);
      this.alphaTarget[i] = a;
      if (reduced) this.alpha[i] = a;
    }

    this.stage = scene.stage;
    this.focus = scene.focus;
    this.kick(now);
  }

  setHover(idx: number | null): void {
    if (idx === this.hover) return;
    this.hover = idx;
    this.kick(0);
  }

  /** Nearest visible incident within a finger's reach (CSS px). */
  hitPoint(x: number, y: number, reach: number): number | null {
    let best: number | null = null;
    let bestD = reach * reach;
    for (let i = 0; i < this.alpha.length; i++) {
      if (this.alphaTarget[i] < 0.3) continue;
      const dx = this.cur[i * 2] - x;
      const dy = this.cur[i * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  hitGroup(x: number, y: number): number | null {
    if (!this.layout || this.stage < 2) return null;
    for (const d of this.layout.disks) {
      if (Math.hypot(d.cx - x, d.cy - y) <= d.r + this.layout.pointR * 3) return d.id;
    }
    return null;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private jitter(i: number): number {
    const x = Math.sin(i * 91.17 + 7.3) * 15731.743;
    return x - Math.floor(x);
  }

  private snapshot(now: number): void {
    const snap = document.createElement("canvas");
    snap.width = this.canvas.width;
    snap.height = this.canvas.height;
    snap.getContext("2d")?.drawImage(this.canvas, 0, 0);
    this.fade = { snap, t0: now, dur: 180 };
    this.busyUntil = Math.max(this.busyUntil, now + 200);
  }

  private kick(now: number): void {
    if (now) this.busyUntil = Math.max(this.busyUntil, now);
    if (this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;
    const t0 = performance.now();
    const moving = this.step(now, dt);
    this.draw(now);
    // Perf probe: set window.__rxCost = [] to collect per-frame engine cost (ms).
    const w = window as unknown as { __rxCost?: number[] };
    w.__rxCost?.push(performance.now() - t0);
    if (moving || now < this.busyUntil) this.raf = requestAnimationFrame(this.frame);
  };

  /** Advance tweens; true while anything still changes. */
  private step(now: number, dt: number): boolean {
    let moving = false;
    const n = this.alpha.length;
    for (let i = 0; i < n; i++) {
      const d = this.dur[i];
      if (d > 0) {
        const t = (now - this.t0[i]) / d;
        if (t >= 1) {
          this.cur[i * 2] = this.to[i * 2];
          this.cur[i * 2 + 1] = this.to[i * 2 + 1];
          this.dur[i] = 0;
        } else {
          moving = true;
          const e = springCalm(Math.max(0, t));
          this.cur[i * 2] = this.from[i * 2] + (this.to[i * 2] - this.from[i * 2]) * e;
          this.cur[i * 2 + 1] =
            this.from[i * 2 + 1] + (this.to[i * 2 + 1] - this.from[i * 2 + 1]) * e;
        }
      }
      const at = this.alphaTarget[i];
      const a = this.alpha[i];
      if (a !== at) {
        const k = 1 - Math.exp(-dt / 70);
        const next = a + (at - a) * k;
        this.alpha[i] = Math.abs(next - at) < 0.01 ? at : next;
        moving = true;
      }
    }
    return moving;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const data = this.data;
    const layout = this.layout;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!data || !layout) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colorT = tweenValue(this.color, now, springCalm);
    const hullT = tweenValue(this.hull, now, springCalm);
    const r = layout.pointR;
    const hullPad = r * 2.6;

    // Hulls under the points.
    if (hullT > 0.01) {
      for (const g of data.groups) {
        const focusT = this.hullFocus.get(g.id);
        const fv = focusT ? tweenValue(focusT, now, springCalm) : 1;
        const hull = convexHull(this.cur, g.members);
        if (hull.length < 2) continue;
        ctx.globalAlpha = hullT * fv;
        ctx.fillStyle = this.tints.get(g.id) ?? this.grey;
        this.roundedHullPath(hull, hullPad);
        ctx.fill();
        if (this.focus === g.id) {
          ctx.globalAlpha = hullT;
          ctx.strokeStyle = (this.ramps.get(g.id) ?? [this.grey])[RAMP - 1];
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // Points, batched by color and opacity bucket.
    const rampIdx = Math.round(colorT * (RAMP - 1));
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < this.alpha.length; i++) {
      const a = this.alpha[i];
      if (a < 0.02) continue;
      const g = this.groupOf[i];
      const gid = g >= 0 ? data.groups[g].id : -1;
      const fill = gid >= 0 ? (this.ramps.get(gid) ?? [this.grey])[rampIdx] : this.grey;
      const key = `${fill}|${Math.round(a * 10)}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(i);
    }
    for (const [key, list] of buckets) {
      const bar = key.lastIndexOf("|");
      ctx.fillStyle = key.slice(0, bar);
      ctx.globalAlpha = Number(key.slice(bar + 1)) / 10;
      ctx.beginPath();
      for (const i of list) {
        const x = this.cur[i * 2];
        const y = this.cur[i * 2 + 1];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Hovered incident: a ring in ink.
    if (this.hover != null && this.hover < this.alpha.length) {
      const x = this.cur[this.hover * 2];
      const y = this.cur[this.hover * 2 + 1];
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Reduced motion: the previous frame fades out over the new one.
    if (this.fade) {
      const t = (now - this.fade.t0) / this.fade.dur;
      if (t >= 1) this.fade = null;
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(this.fade.snap, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Convex hull grown by `pad` with round corners (a soft blob). */
  private roundedHullPath(hull: number[], pad: number): void {
    const ctx = this.ctx;
    const m = hull.length / 2;
    ctx.beginPath();
    if (m < 3) {
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < m; k++) {
        cx += hull[k * 2];
        cy += hull[k * 2 + 1];
      }
      cx /= m;
      cy /= m;
      const ext = m === 2 ? Math.hypot(hull[0] - hull[2], hull[1] - hull[3]) / 2 : 0;
      ctx.arc(cx, cy, ext + pad, 0, Math.PI * 2);
      return;
    }
    // Monotone chain gives counter-clockwise order in y-up math, which is
    // clockwise on screen (y down); outward normal of edge (dx, dy) is (dy, -dx).
    const normals: number[] = [];
    for (let k = 0; k < m; k++) {
      const ax = hull[k * 2];
      const ay = hull[k * 2 + 1];
      const bx = hull[((k + 1) % m) * 2];
      const by = hull[((k + 1) % m) * 2 + 1];
      normals.push(Math.atan2(-(bx - ax), by - ay));
    }
    for (let k = 0; k < m; k++) {
      const prev = normals[(k - 1 + m) % m];
      const next = normals[k];
      ctx.arc(hull[k * 2], hull[k * 2 + 1], pad, prev, next, false);
    }
    ctx.closePath();
  }
}
