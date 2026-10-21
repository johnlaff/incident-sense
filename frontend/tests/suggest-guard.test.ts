import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { isSuggestResponse, suggestErrorMessage } from "@/lib/suggest-guard";
import { suggestFixture } from "./suggest-fixture";

describe("suggest response guard (E2E P1-7)", () => {
  it("accepts a real response", () => {
    expect(isSuggestResponse(suggestFixture())).toBe(true);
  });

  it("rejects a 200 with an unexpected body", () => {
    expect(isSuggestResponse({ foo: 1 })).toBe(false);
    expect(isSuggestResponse(null)).toBe(false);
    expect(isSuggestResponse({ ...suggestFixture(), steps: undefined })).toBe(false);
    expect(isSuggestResponse({ ...suggestFixture(), publication: null })).toBe(false);
  });
});

describe("suggest error message (auditoria P2-9)", () => {
  it("says the AI is not configured only when the server says so", () => {
    const missing = new ApiError(
      503,
      "API key is not configured. Set OPENROUTER_API_KEY",
    );
    expect(suggestErrorMessage(missing)).toBe(
      "A IA não está configurada neste servidor.",
    );
  });

  it("keeps the server's own words for other 503s", () => {
    expect(suggestErrorMessage(new ApiError(503, "A IA está sem cota agora."))).toBe(
      "A IA está sem cota agora.",
    );
  });

  it("does not blame configuration for a proxy page during a restart", () => {
    expect(
      suggestErrorMessage(new ApiError(503, "O servidor respondeu com erro 503.")),
    ).toBe("O servidor está reiniciando. Tente de novo em alguns segundos.");
  });
});
