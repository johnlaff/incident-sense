// Pins the group palette rules from the second and third independent reviews.
import { describe, expect, it } from "vitest";

import { CLUSTER_TONES } from "@/lib/model";

type Lab = [number, number, number];

function lab(l: number, c: number, h: number): Lab {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

/** Relative luminance (WCAG) of an OKLCH color, clipped to sRGB. */
function luminance(l: number, c: number, h: number): number {
  const [L, a, b] = lab(l, c, h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(y1: number, y2: number): number {
  return (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
}

describe("CLUSTER_TONES", () => {
  it("has nine tones, none purple near the AI violet", () => {
    expect(CLUSTER_TONES).toHaveLength(9);
    for (const t of CLUSTER_TONES) expect(t.h < 262 || t.h > 335).toBe(true);
  });

  it("stays off the concept hues (Incidente, Problema, Change)", () => {
    const gap = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return Math.min(d, 360 - d);
    };
    for (const t of CLUSTER_TONES)
      for (const concept of [255, 68, 178])
        expect(gap(t.h, concept), `hue ${t.h} vs ${concept}`).toBeGreaterThanOrEqual(26);
  });

  it("keeps every pair apart in both themes", () => {
    for (const dark of [false, true]) {
      const labs = CLUSTER_TONES.map((t) =>
        dark ? lab(t.dl, t.dc, t.h) : lab(t.l, t.c, t.h),
      );
      for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
          const d = Math.hypot(...labs[i].map((v, k) => (v - labs[j][k]) * 100));
          expect(d, `${dark ? "dark" : "light"} ${i}/${j}`).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it("reads at 3:1 or more on the card and on the group tint", () => {
    for (const t of CLUSTER_TONES) {
      const light = luminance(t.l, t.c, t.h);
      expect(contrast(light, 1)).toBeGreaterThanOrEqual(3);
      expect(contrast(light, luminance(0.955, 0.028, t.h))).toBeGreaterThanOrEqual(3);
      const dark = luminance(t.dl, t.dc, t.h);
      expect(contrast(dark, luminance(0.185, 0.005, 265))).toBeGreaterThanOrEqual(3);
      expect(contrast(dark, luminance(0.31, 0.04, t.h))).toBeGreaterThanOrEqual(3);
      // Out of focus (map-engine dims): still 3:1 against the card.
      expect(contrast(luminance(0.66, 0.04, t.h), 1)).toBeGreaterThanOrEqual(3);
      expect(
        contrast(luminance(0.52, 0.04, t.h), luminance(0.185, 0.005, 265)),
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
