// E2E rodada 3, P2 de texto: o que a tela diz não deve ser lido de outro jeito.
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAPTERS } from "@/app/como-funciona/story";
import { buildSteps, fmtDelta } from "@/app/changes/sequence";
import { api } from "@/lib/api";
import { BEATS } from "@/lib/pipeline";
import type { Evaluation } from "@/lib/changes";

import fixture from "./evaluation-fixture.json";

afterEach(() => vi.unstubAllGlobals());

describe("P2-3: a passing average is not read as 8,0", () => {
  it("says it passed the minimum, with its own number", () => {
    const ev = fixture.CHG0031001 as unknown as Evaluation;
    const portao = buildSteps(ev).find((s) => s.id === "portao")!;
    expect(portao.caption).not.toMatch(/chegou a/);
    expect(portao.caption).toMatch(/passou do mínimo de 8,0/);
    expect(portao.caption).toMatch(/8,62/);
  });
});

describe("P2-4: an unchanged grade is not a second grade of 0,0", () => {
  it("reads 'igual'", () => {
    expect(fmtDelta(0)).toBe("igual");
    expect(fmtDelta(0, 2)).toBe("igual");
  });
});

describe("P2-7: chapter 1 warns the live numbers change", () => {
  it("says so next to the real run", () => {
    const text = JSON.stringify(CHAPTERS);
    const note = text.match(/avaliação real da CHG0031002[^"]*/)![0];
    expect(note).toMatch(/ao vivo/i);
  });
});

describe("P2-8: one way to write 3.072", () => {
  it("uses the thousands dot everywhere", () => {
    expect(JSON.stringify(CHAPTERS)).not.toMatch(/3072 números/);
    expect(JSON.stringify(BEATS)).not.toMatch(/3072 números/);
  });
});

describe("P2-17: a raw English error becomes Portuguese", () => {
  it("does not show 'Internal Server Error'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: "Internal Server Error" }),
      }),
    );
    const err = await api.getHealth().catch((e) => e);
    expect(err.detail).not.toMatch(/Internal Server Error/);
    expect(err.detail).toMatch(/servidor/);
  });
});
