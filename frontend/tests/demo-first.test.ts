import { describe, expect, it } from "vitest";

import { DEMO_CHANGES, DEMO_INCIDENTS, demoFirst } from "@/lib/demo-first";

const rows = (...numbers: string[]) => numbers.map((number) => ({ number }));

describe("demo records come first in their lists", () => {
  it("puts the demo Changes on top in demo order, the rest unchanged", () => {
    const list = rows(
      "CHG0031012",
      "CHG0031003",
      "CHG0031009",
      "CHG0031001",
      "CHG0031002",
    );
    expect(demoFirst(list, DEMO_CHANGES).map((r) => r.number)).toEqual([
      "CHG0031001",
      "CHG0031002",
      "CHG0031003",
      "CHG0031012",
      "CHG0031009",
    ]);
  });

  it("puts the demo incidents on top and skips the ones a filter removed", () => {
    const list = rows("INC0053999", "INC0053084", "INC0050001");
    expect(demoFirst(list, DEMO_INCIDENTS).map((r) => r.number)).toEqual([
      "INC0053084",
      "INC0053999",
      "INC0050001",
    ]);
  });
});
