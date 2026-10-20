import { describe, expect, it } from "vitest";
import { keepWhole } from "@/lib/text";

describe("keepWhole", () => {
  it("keeps names whole and leaves other hyphens alone", () => {
    expect(keepWhole("Pool do PIX-Core")).toBe("Pool do PIX‑Core");
    expect(keepWhole("App-Mobile: cache")).toBe("App‑Mobile: cache");
    expect(keepWhole("de 40 - 80")).toBe("de 40 - 80");
  });
});
