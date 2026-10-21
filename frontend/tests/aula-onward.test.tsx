// E2E rodada 2 P1-3: the last step of a chapter offers the next chapter, not
// only "Voltar ao roteiro". logica-2 P2-N14: on /aula the sheet never sends
// the presenter to the page they are on.
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

const nav = vi.hoisted(() => ({ path: "/como-funciona" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
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
  nav.path = "/como-funciona";
});

const STEPS = [
  { title: "Um", caption: "Primeiro." },
  { title: "Dois", caption: "Segundo." },
];

function Chapter({ onNext }: { onNext?: () => void }) {
  const lesson = useAulaLesson({
    id: "cap",
    steps: STEPS,
    runKey: "r",
    onward: onNext ? { label: "Próximo capítulo", go: onNext } : null,
  });
  useAulaStart("cap", lesson.replay);
  return <p>passo {lesson.step}</p>;
}

async function on() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Modo aula" }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("fim de capítulo em modo aula", () => {
  it("offers the next chapter on the last step", async () => {
    const go = vi.fn();
    render(
      <AulaProvider>
        <AulaToggle />
        <Chapter onNext={go} />
      </AulaProvider>,
    );
    await on();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Próximo passo" }));
    });
    const next = screen.getByRole("button", { name: /Próximo capítulo/ });
    expect(screen.queryByRole("link", { name: /Voltar ao roteiro/ })).toBeNull();
    fireEvent.click(next);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("the last chapter still goes back to the roteiro", async () => {
    render(
      <AulaProvider>
        <AulaToggle />
        <Chapter />
      </AulaProvider>,
    );
    await on();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Próximo passo" }));
    });
    expect(screen.getByRole("link", { name: /Voltar ao roteiro/ })).toBeInTheDocument();
  });
});

describe("modo aula ligado em /aula", () => {
  it("does not offer the roteiro it is already on", async () => {
    nav.path = "/aula";
    render(
      <AulaProvider>
        <AulaToggle />
        <p>Roteiro</p>
      </AulaProvider>,
    );
    await on();
    expect(screen.queryByRole("link", { name: "Roteiro da aula" })).toBeNull();
    expect(screen.getByRole("link", { name: /Começar/ })).toHaveAttribute(
      "href",
      FIRST_STOP,
    );
    expect(screen.queryByText(/Esta tela não tem passo a passo/)).toBeNull();
  });
});
