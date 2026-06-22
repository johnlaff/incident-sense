import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("api client", () => {
  it("returns parsed JSON on success", async () => {
    stubFetch({ ok: true, json: async () => ({ status: "ok" }) });
    await expect(api.getHealth()).resolves.toEqual({ status: "ok" });
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
