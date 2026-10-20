import { describe, expect, it } from "vitest";

import { homeTarget } from "@/lib/home-route";

describe("homeTarget", () => {
  it("opens the incident queue without a lesson flag", () => {
    expect(homeTarget({})).toBe("/incidentes");
    expect(homeTarget({ state: "open" })).toBe("/incidentes?state=open");
  });

  it("opens the lesson start for /?aula=1 and keeps the query", () => {
    expect(homeTarget({ aula: "1" })).toBe("/aula?aula=1");
    expect(homeTarget({ aula: "1", x: ["a", "b"] })).toBe("/aula?aula=1&x=a&x=b");
  });

  it("keeps the queue when the lesson is turned off", () => {
    expect(homeTarget({ aula: "0" })).toBe("/incidentes?aula=0");
  });
});
