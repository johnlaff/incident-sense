// The records walked through in a live demo come first in their lists, so the
// presenter and the audience find them without scrolling or searching.

/** Incidents of the demo: one procedente with a suggestion, one improcedente. */
export const DEMO_INCIDENTS = ["INC0052233", "INC0053084"] as const;

/** Changes of the demo: passes, fails on coherence, fails on the fields. */
export const DEMO_CHANGES = ["CHG0031001", "CHG0031002", "CHG0031003"] as const;

/** The demo records first, in the given order; the rest keeps its order. */
export function demoFirst<T extends { number: string }>(
  rows: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((n, i) => [n, i]));
  const pinned = rows
    .filter((r) => rank.has(r.number))
    .sort((a, b) => rank.get(a.number)! - rank.get(b.number)!);
  return [...pinned, ...rows.filter((r) => !rank.has(r.number))];
}
