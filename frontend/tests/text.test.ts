import { describe, expect, it } from "vitest";
import { keepWhole } from "@/lib/text";

describe("keepWhole", () => {
  it("keeps names whole and leaves other hyphens alone", () => {
    expect(keepWhole("Pool do PIX-Core")).toBe("Pool do PIX‑Core");
    expect(keepWhole("App-Mobile: cache")).toBe("App‑Mobile: cache");
    expect(keepWhole("de 40 - 80")).toBe("de 40 - 80");
  });
});

describe("matchesQuery (E2E P2-1)", () => {
  it("ignores accents both ways", async () => {
    const { matchesQuery } = await import("@/lib/text");
    expect(matchesQuery("Cartões-Autorizador", "Cartoes")).toBe(true);
    expect(matchesQuery("Cartoes-Autorizador", "Cartões")).toBe(true);
  });
  it("treats only spaces as no query, and squeezes spaces", async () => {
    const { matchesQuery } = await import("@/lib/text");
    expect(matchesQuery("Pix lento", "   ")).toBe(true);
    expect(matchesQuery("Pix lento", "  pix   lento ")).toBe(true);
    expect(matchesQuery("Pix lento", "boleto")).toBe(false);
  });
});
