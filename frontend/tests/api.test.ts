import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, withAccents, withoutAccents } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("api client", () => {
  it("returns parsed JSON on success", async () => {
    stubFetch({ ok: true, text: async () => JSON.stringify({ status: "ok" }) });
    await expect(api.getHealth()).resolves.toEqual({ status: "ok" });
  });

  it("shows team names with their accent", async () => {
    stubFetch({
      ok: true,
      text: async () => JSON.stringify({ group: "Sustentacao-Pagamentos" }),
    });
    await expect(api.getHealth()).resolves.toEqual({ group: "Sustentação-Pagamentos" });
  });

  it("accents service names on screen and stores them back for filters", () => {
    expect(
      withAccents("Cartoes-Autorizador · Estacao-Trabalho · Integracoes-OpenFinance"),
    ).toBe("Cartões-Autorizador · Estação-Trabalho · Integrações-OpenFinance");
    expect(withoutAccents("Cartões-Autorizador")).toBe("Cartoes-Autorizador");
  });

  it("throws ApiError carrying the backend detail on error responses", async () => {
    stubFetch({ ok: false, status: 503, json: async () => ({ detail: "sem chaves" }) });
    await expect(api.getClusters()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      detail: "sem chaves",
    });
  });

  it("throws ApiError(0) when the network is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const error = await api.getHealth().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});

describe("AI calls give up after a while (auditoria P1-14)", () => {
  it("rejects with a PT-BR message when the AI takes too long", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(new DOMException("timed out", "TimeoutError"));
      }),
    );
    const error = await api
      .evaluateChange("CHG0031001", { fields: {}, model: "m" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toBe("A IA demorou demais. Tente de novo.");
  });

  it("sends a time limit with the analysis too", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetch);
    await api.suggest({ incident_number: "INC1" } as never);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
