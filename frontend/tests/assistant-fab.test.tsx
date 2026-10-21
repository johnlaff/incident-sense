// The assistant chat must be reachable: its button never hides because the
// purple "Analisar com a IA" (or any other AI entry) is on screen.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AssistantFab, TUCK_REST_MS, nextTucked } from "@/components/assistant-fab";

beforeAll(() => {
  // Every observed element is on screen, as the header button is at the top.
  globalThis.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.cb(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Page({ open = false }: { open?: boolean }) {
  return (
    <>
      <button data-ai-entry="">Analisar com a IA</button>
      <div data-ai-entry="">Ainda sem solução</div>
      <AssistantFab open={open} onOpen={() => {}} />
    </>
  );
}

describe("assistant button", () => {
  it("stays visible while an AI entry is in view", () => {
    render(<Page />);
    const fab = screen.getByRole("button", { name: /Perguntar à IA/ });
    expect(fab.className).not.toMatch(/\bhidden\b/);
    expect(fab.className).not.toMatch(/\btucked\b/);
  });

  it("says what it does in words, not only an icon", () => {
    render(<Page />);
    expect(screen.getByText("Perguntar à IA")).toBeInTheDocument();
  });

  it("hides only while the chat is open", () => {
    render(<Page open />);
    const fab = screen.getByRole("button", { name: /Perguntar à IA/, hidden: true });
    expect(fab.className).toMatch(/\bhidden\b/);
  });

  it("comes back on its own once a phone scroll rests", () => {
    vi.useFakeTimers();
    render(<Page />);
    const fab = screen.getByRole("button", { name: /Perguntar à IA/ });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 5000,
      configurable: true,
    });
    act(() => {
      window.scrollY = 600;
      fireEvent.scroll(window);
    });
    expect(fab.className).toMatch(/\btucked\b/);
    act(() => {
      vi.advanceTimersByTime(TUCK_REST_MS + 10);
    });
    expect(fab.className).not.toMatch(/\btucked\b/);
  });
});

describe("nextTucked", () => {
  const phone = true;
  it("tucks on the way down and returns on the way up", () => {
    expect(nextTucked(false, { y: 600, lastY: 400, atEnd: false, phone })).toBe(true);
    expect(nextTucked(true, { y: 400, lastY: 600, atEnd: false, phone })).toBe(false);
  });
  it("is always out near the top, at the end and on a wide screen", () => {
    expect(nextTucked(true, { y: 40, lastY: 20, atEnd: false, phone })).toBe(false);
    expect(nextTucked(true, { y: 3000, lastY: 2000, atEnd: true, phone })).toBe(false);
    expect(nextTucked(true, { y: 900, lastY: 400, atEnd: false, phone: false })).toBe(
      false,
    );
  });
});
