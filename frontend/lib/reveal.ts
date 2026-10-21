// Bring a lesson's subject into the free band of the screen: below the top
// bar, above the aula caption strip and the phone tab bar. scrollIntoView
// alone misses on this layout: on desktop the scroller is <main>, a subject
// inside a sticky aside moves less than the scroll, and the caption strip
// changes height with each caption. So this measures, scrolls, and checks
// again once the strip and the sticky aside have settled.

function scroller(el: Element): HTMLElement | null {
  const main = el.closest<HTMLElement>(".main");
  if (main && main.scrollHeight > main.clientHeight + 1) {
    const oy = getComputedStyle(main).overflowY;
    if (oy === "auto" || oy === "scroll") return main;
  }
  return null; // the window
}

/** The visible band (viewport px) between the top bar and the bottom strips. */
export function freeBand(): { top: number; bottom: number } {
  const topbar = document.querySelector(".topbar");
  const top = (topbar ? topbar.getBoundingClientRect().bottom : 0) + 8;
  let bottom = window.innerHeight;
  for (const sel of [".aula-bar", ".tabbar"]) {
    const node = document.querySelector<HTMLElement>(sel);
    if (!node || getComputedStyle(node).display === "none") continue;
    bottom = Math.min(bottom, node.getBoundingClientRect().top);
  }
  return { top, bottom: bottom - 12 };
}

function delta(el: Element, below: Element | null): number {
  const windowScrolls = scroller(el) === null;
  const band = freeBand();
  // A sticky block (the shared visual of a chapter on a phone) also covers
  // the top of the band. Measure where it ends once stuck, not where it sits
  // now: on entering a chapter it is still in the flow, lower on the screen.
  if (below) {
    const b = below.getBoundingClientRect();
    const css = getComputedStyle(below);
    // Only when the window scrolls (phones): a sticky offset inside <main>
    // is not a viewport position.
    const stuckTop =
      windowScrolls && css.position === "sticky" ? parseFloat(css.top) || 0 : b.top;
    band.top = Math.max(band.top, Math.min(b.top, stuckTop) + b.height + 12);
  }
  const r = el.getBoundingClientRect();
  const room = band.bottom - band.top;
  // Taller than the band: show its start.
  if (r.height > room) return r.top - band.top;
  if (r.bottom > band.bottom) return r.bottom - band.bottom;
  if (r.top < band.top) return r.top - band.top;
  return 0;
}

function scrollByDelta(el: Element, d: number, smooth: boolean): void {
  if (Math.abs(d) < 2) return;
  const box = scroller(el);
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  if (box) box.scrollBy({ top: d, behavior });
  else window.scrollBy({ top: d, behavior });
}

/**
 * Scroll so `el` sits whole in the free band (or its top, when it is taller).
 * Returns a cancel function. With reduced motion the jump is instant.
 */
export function revealSubject(
  el: Element | null,
  reduced: boolean,
  below: Element | null = null,
): () => void {
  if (!el) return () => {};
  scrollByDelta(el, delta(el, below), !reduced);
  // Check again after the smooth scroll, the strip and a sticky aside settle.
  const timers = [450, 900, 1300].map((ms) =>
    window.setTimeout(
      () => scrollByDelta(el, delta(el, below), !reduced),
      reduced ? ms / 3 : ms,
    ),
  );
  return () => timers.forEach((t) => window.clearTimeout(t));
}
