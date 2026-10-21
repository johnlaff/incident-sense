// /aula shows the records' real titles and statuses: checked against backend/data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STOPS } from "@/app/aula/stops";
import { STATE_LABEL as CHG_STATE } from "@/lib/changes";
import { PRIORITY_LABEL, STATE_LABEL, dsState, pCode } from "@/lib/model";

const here = dirname(fileURLToPath(import.meta.url));
const data = (name: string) =>
  JSON.parse(readFileSync(join(here, "../../backend/data", name), "utf8")) as Record<
    string,
    unknown
  >[];

describe("/aula picks", () => {
  const incidents = new Map(data("incidents.json").map((r) => [r.number as string, r]));
  const changes = new Map(data("changes.json").map((r) => [r.number as string, r]));
  const picks = STOPS.flatMap((s) => s.picks ?? []);

  it("covers the records of the lesson script", () => {
    expect(picks.map((p) => p.number)).toEqual([
      "INC0052233",
      "CHG0031001",
      "CHG0031002",
    ]);
  });

  it.each(picks.map((p) => [p.number, p] as const))(
    "%s: real title and status",
    (_, p) => {
      const inc = incidents.get(p.number);
      if (inc) {
        expect(p.title).toBe(inc.short_description);
        const prio = PRIORITY_LABEL[pCode(inc.priority as number)].toLowerCase();
        expect(p.status).toBe(
          `${STATE_LABEL[dsState(inc.state as string)]} · Prioridade ${prio}`,
        );
        return;
      }
      const chg = changes.get(p.number);
      expect(chg).toBeDefined();
      expect(p.title).toBe(chg?.short_description);
      expect(p.status).toBe(
        `${CHG_STATE[chg?.state as string]} · Risco ${(chg?.risk as string).toLowerCase()}`,
      );
    },
  );
});

describe("no stop promises the AI's answer (auditoria P1-13)", () => {
  it("CHG0031001 does not say it will pass", () => {
    const text = JSON.stringify(STOPS);
    expect(text).not.toMatch(/deve passar/);
    expect(text).toContain("Bem preenchida: vamos ver o que a IA diz");
  });
});
