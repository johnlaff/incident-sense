// The header's "Modo aula" button must visibly start something on every
// screen: the screen's own lesson at step 1, or the sheet with the roteiro.
// Before, it only flipped a flag, so on most screens nothing changed.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AulaProvider,
  AulaToggle,
  FIRST_STOP,
  useAulaLesson,
  useAulaStart,
} from "@/components/aula";

vi.mock("next/navigation", () => ({ usePathname: () => "/x" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  document.elementFromPoint ??= () => null;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-aula");
});

const STEPS = [
  { title: "Um", caption: "Primeiro passo da tela." },
  { title: "Dois", caption: "Segundo passo da tela." },
  { title: "Tres", caption: "Terceiro passo da tela." },
];

/** A screen whose lesson waits for its own button, like the change page. */
function Screen({ id = "tela" }: { id?: string }) {
  const lesson = useAulaLesson({ id, steps: STEPS, runKey: "r1" });
  const { skip, done } = lesson;
  // Outside modo aula the result shows whole, as the real screens do.
  if (!lesson.aula && !done && lesson.step >= 0) queueMicrotask(skip);
  useAulaStart(id, lesson.replay);
  return <p>passo {lesson.step}</p>;
}

function tap(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerType: "touch" });
  fireEvent.pointerUp(el, { pointerType: "touch" });
  fireEvent.click(el);
}

async function turnOn() {
  const button = screen.getByRole("button", { name: "Modo aula" });
  await act(async () => {
    tap(button);
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("Modo aula no cabeçalho", () => {
  it("starts the screen's lesson at step 1 on a tap", async () => {
    render(
      <AulaProvider>
        <AulaToggle />
        <Screen />
      </AulaProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText(/Passo 1 de 3/)).toBeNull();
    await turnOn();
    expect(screen.getByText(/Passo 1 de 3/)).toBeInTheDocument();
    expect(screen.getByText("Primeiro passo da tela.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Modo aula ligado/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the roteiro and a one-tap start on a screen without a lesson", async () => {
    render(
      <AulaProvider>
        <AulaToggle />
        <p>Lista</p>
      </AulaProvider>,
    );
    await turnOn();
    expect(screen.getByRole("link", { name: "Roteiro da aula" })).toHaveAttribute(
      "href",
      "/aula?aula=1",
    );
    expect(screen.getByRole("link", { name: /Começar/ })).toHaveAttribute(
      "href",
      FIRST_STOP,
    );
  });

  it("starts the lesson of the screen shown after client-side navigation", async () => {
    function App({ page }: { page: "lista" | "tela" }) {
      return (
        <AulaProvider>
          <AulaToggle />
          {page === "lista" ? <p>Lista</p> : <Screen id="outra" />}
        </AulaProvider>
      );
    }
    const { rerender } = render(<App page="lista" />);
    rerender(<App page="tela" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await turnOn();
    expect(screen.getByText(/Passo 1 de 3/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Roteiro da aula" })).toBeNull();
  });

  it("turning it off hides the strip", async () => {
    render(
      <AulaProvider>
        <AulaToggle />
        <Screen />
      </AulaProvider>,
    );
    await turnOn();
    await act(async () => {
      tap(screen.getByRole("button", { name: /Modo aula ligado/ }));
    });
    expect(screen.queryByText(/Passo 1 de 3/)).toBeNull();
  });
});
