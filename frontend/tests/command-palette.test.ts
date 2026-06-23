import { describe, expect, it } from "vitest";

import { filterCommands, type Command } from "@/lib/command-palette";

const commands: Command[] = [
  { id: "suggest", label: "Sugerir resolução", group: "Ações", run: () => {} },
  { id: "recur", label: "Ir para Recorrências", group: "Navegar", run: () => {} },
  {
    id: "how",
    label: "Como funciona",
    group: "Navegar",
    keywords: "pipeline rag",
    run: () => {},
  },
];

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands(commands, "  ")).toHaveLength(3);
  });

  it("matches on label", () => {
    expect(filterCommands(commands, "recor").map((c) => c.id)).toEqual(["recur"]);
  });

  it("matches on group and keywords", () => {
    expect(filterCommands(commands, "navegar").map((c) => c.id)).toEqual([
      "recur",
      "how",
    ]);
    expect(filterCommands(commands, "pipeline").map((c) => c.id)).toEqual(["how"]);
  });
});
