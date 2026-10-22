// Spec #128: the public demo against someone who wants to spend its key. The
// server now bounds every text it sends to the model and the site answers with
// basic security headers; the screen keeps the person inside those limits and
// explains a refusal in Portuguese.
import { describe, expect, it } from "vitest";

import nextConfig, { SECURITY_HEADERS } from "../next.config";
import { errorDetail } from "@/lib/api";
import { FIELD_MAX_CHARS } from "@/lib/changes";

describe("security headers", () => {
  it("every route gets nosniff, a short Referer, no framing and no device features", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
      ]),
    );
    expect(SECURITY_HEADERS.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(SECURITY_HEADERS.find((h) => h.key === "X-Content-Type-Options")?.value).toBe(
      "nosniff",
    );
  });
});

describe("texts past their limit", () => {
  it("an edited Change field too long is said in Portuguese, with the limit", () => {
    const detail = errorDetail(422, [
      {
        type: "string_too_long",
        loc: ["body", "fields", "objective"],
        msg: "String should have at most 6000 characters",
        ctx: { max_length: 6000 },
      },
    ]);
    expect(detail).toMatch(/6000 caracteres/);
    expect(detail).not.toMatch(/String should|pergunta/);
  });

  it("the question keeps its own sentence", () => {
    const detail = errorDetail(422, [
      { type: "string_too_long", loc: ["body", "question"], ctx: { max_length: 600 } },
    ]);
    expect(detail).toMatch(/pergunta passou de 600/);
  });

  it("the editor stops where the server does", () => {
    expect(FIELD_MAX_CHARS).toBe(6000);
  });
});
