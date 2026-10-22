// Rodada 5, ponto aberto: abrir o chat pela etapa 7 da aula não pode recomeçar
// a barra em "Etapa 1 de 7". A lesson can start at its end in modo aula, and
// the assistant panel does so unless the panel itself ran the analysis.
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AulaProvider, useAula, useAulaLesson } from "@/components/aula";

vi.mock("next/navigation", () => ({ usePathname: () => "/incidentes/INC0052233" }));
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
});

const STEPS = Array.from({ length: 7 }, (_, i) => ({
  title: `P${i + 1}`,
  caption: `Legenda ${i + 1}.`,
  counter: `Etapa ${i + 1} de 7`,
}));

function Panel({ startAt }: { startAt?: "first" | "end" }) {
  const lesson = useAulaLesson({ id: "painel", steps: STEPS, runKey: "r1", startAt });
  return <p data-testid="step">{lesson.step}</p>;
}

/** Mounted once modo aula is on, like a panel opened during the lesson. */
function WhenOn({ children }: { children: ReactNode }) {
  return useAula().aula ? <>{children}</> : null;
}

async function mount(node: ReactNode) {
  localStorage.setItem("is-aula", "1");
  render(
    <AulaProvider>
      <WhenOn>{node}</WhenOn>
    </AulaProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("a lesson that starts at its end, in modo aula", () => {
  it("the bar shows the last step, not 'Etapa 1 de 7'", async () => {
    await mount(<Panel startAt="end" />);
    expect(screen.getByRole("region", { name: "Modo aula" }).textContent).toMatch(
      /Etapa 7 de 7/,
    );
    expect(screen.getByTestId("step").textContent).toBe("6");
  });

  it("by default it still starts at step 1 and waits", async () => {
    await mount(<Panel />);
    expect(screen.getByRole("region", { name: "Modo aula" }).textContent).toMatch(
      /Etapa 1 de 7/,
    );
  });
});

describe("the assistant panel asks for it", () => {
  it("starts at the end unless the panel itself ran the analysis", () => {
    const src = readFileSync(
      join(__dirname, "..", "app", "incidentes", "[number]", "page.tsx"),
      "utf8",
    );
    expect(src).toMatch(/usePipelineLesson\("aurora", open \? shown : null, \{/);
    expect(src).toMatch(/startAt: teach \? "first" : "end"/);
  });
});
