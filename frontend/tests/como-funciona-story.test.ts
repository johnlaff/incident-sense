// The "Como funciona" walkthrough: what it labels as "dado do demo" must match
// the committed demo data and config, and the copy follows the house rules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { appHref } from "@/app/como-funciona/chapter";
import {
  CANDIDATES,
  CHAPTERS,
  CHG2_AVERAGE,
  REAL_EVAL_SECONDS,
  CHG2_BACKOUT,
  CHG2_TASKS,
  CLUSTERS_DEMO,
  EXAMPLE_GRADES,
  GATE,
  IMPROCEDENTE,
  INCIDENT,
  PROBLEM,
  RETRIEVAL,
  RUBRIC,
  RUBRIC_VERSION,
  TAG_FUNNEL,
  TOTAL_WEIGHT,
  allCopy,
  funnel,
  latencySummary,
  lessonSteps,
  miniMap,
  queryText,
  weightedSegments,
} from "@/app/como-funciona/story";

const here = dirname(fileURLToPath(import.meta.url));
const backend = (path: string) => readFileSync(join(here, "../../backend", path), "utf8");

interface Rec {
  number: string;
  state: string;
  tags: string[];
  short_description: string;
}

describe("dados do demo", () => {
  it("mirrors rubrica.toml", () => {
    const toml = backend("src/incident_sense/changes/rubrica.toml");
    expect(toml).toContain(`version = "${RUBRIC_VERSION}"`);
    expect(toml).toContain(`eligibility_threshold = ${GATE.toFixed(1)}`);
    const weights = [...toml.matchAll(/key = "(\w+)"[\s\S]*?weight = ([\d.]+)/g)].map(
      (m) => [m[1], Number(m[2])],
    );
    expect(weights).toEqual(RUBRIC.map((r) => [r.key, r.weight]));
    expect(TOTAL_WEIGHT).toBe(13.5);
  });

  it("mirrors the retrieval settings", () => {
    const config = backend("src/incident_sense/config.py");
    expect(config).toContain(`retrieval_min_similarity: float = ${RETRIEVAL.floor}`);
    expect(config).toContain(`incident_top_k: int = ${RETRIEVAL.incidentTopK}`);
    expect(config).toContain(`problem_top_k: int = ${RETRIEVAL.problemTopK}`);
  });

  it("counts the tag layer from the committed records", () => {
    const incidents = JSON.parse(backend("data/incidents.json")) as Rec[];
    const problems = JSON.parse(backend("data/problems.json")) as Rec[];
    const resolved = incidents.filter((i) => ["Resolved", "Closed"].includes(i.state));
    const share = (r: Rec) =>
      r.tags.some((t) => (INCIDENT.tags as readonly string[]).includes(t));
    expect(resolved.length).toBe(TAG_FUNNEL.incidents);
    expect(problems.length).toBe(TAG_FUNNEL.problems);
    expect(resolved.filter(share).length).toBe(TAG_FUNNEL.matchIncidents);
    expect(problems.filter(share).length).toBe(TAG_FUNNEL.matchProblems);
  });

  it("uses real records with their real titles", () => {
    const incidents = JSON.parse(backend("data/incidents.json")) as (Rec & {
      description: string;
    })[];
    const problems = JSON.parse(backend("data/problems.json")) as (Rec & {
      linked_incidents: string[];
      root_cause: string;
      permanent_fix: string;
    })[];
    const inc = incidents.find((i) => i.number === INCIDENT.number)!;
    expect(inc.short_description).toBe(INCIDENT.title);
    expect(inc.description).toBe(INCIDENT.description);
    expect(inc.tags).toEqual(INCIDENT.tags);
    const imp = incidents.find((i) => i.number === IMPROCEDENTE.number)!;
    expect(imp.short_description).toBe(IMPROCEDENTE.title);
    expect(imp.tags).toContain("improcedente");
    const byNumber = new Map(
      [...incidents, ...problems].map((r) => [r.number, r.short_description]),
    );
    for (const c of CANDIDATES) expect(byNumber.get(c.number)).toBe(c.title);
    const prb = problems.find((p) => p.number === PROBLEM.number)!;
    expect(prb.linked_incidents.length).toBe(PROBLEM.linked);
    expect(prb.root_cause).toBe(PROBLEM.rootCause);
    expect(prb.permanent_fix).toBe(PROBLEM.permanentFix);
  });

  it("quotes CHG0031002 as committed", () => {
    const changes = JSON.parse(backend("data/changes.json")) as {
      number: string;
      backout_plan: string;
      tasks: { number: string; short_description: string }[];
    }[];
    const chg = changes.find((c) => c.number === "CHG0031002")!;
    expect(chg.backout_plan).toBe(CHG2_BACKOUT);
    expect(chg.tasks.map((t) => [t.number, t.short_description])).toEqual(
      CHG2_TASKS.map((t) => [t.number, t.text]),
    );
  });

  it("matches the clustering totals", () => {
    const clusters = JSON.parse(backend("data/precomputed/clusters.json")) as {
      total: number;
      outliers: number;
      clusters: { cluster_id: number; label: string }[];
    };
    expect(clusters.total).toBe(CLUSTERS_DEMO.incidents);
    expect(clusters.outliers).toBe(CLUSTERS_DEMO.isolated);
    expect(clusters.clusters.filter((c) => c.cluster_id >= 0).length).toBe(
      CLUSTERS_DEMO.groups,
    );
  });
});

describe("a conta", () => {
  it("averages the grades to the 8,87 the app shows for CHG0031002 (E2E P0-3)", () => {
    const { average } = weightedSegments(EXAMPLE_GRADES);
    expect(average).toBe(8.87);
    expect(average).toBe(CHG2_AVERAGE);
  });

  it("parallel calls take the slowest, under the real 8 s with coherence", () => {
    const { parallel, queue } = latencySummary();
    expect(parallel).toBe(6.2);
    expect(parallel).toBeLessThan(REAL_EVAL_SECONDS);
    expect(queue).toBeGreaterThan(REAL_EVAL_SECONDS);
  });

  it("chapter 1 opens the Change it shows", () => {
    expect(CHAPTERS[0].app.href).toBe("/changes/CHG0031002");
  });

  it("chapter 4 uses the real neighbours of INC0052233 (E2E P0-2)", () => {
    expect(CANDIDATES.map((c) => c.number)).toEqual([
      "INC0052219",
      "INC0052228",
      "INC0052273",
      "INC0052202",
      "INC0052209",
      "PRB0004105",
      "PRB0004104",
    ]);
  });

  it("funnels 7 to 7 to 7, like the app", () => {
    expect(funnel()).toEqual({ found: 7, passed: 7, kept: 7 });
    expect(CANDIDATES.filter((c) => c.kind === "incidente").length).toBeLessThanOrEqual(
      RETRIEVAL.incidentTopK,
    );
  });

  it("builds the query like build_query_text", () => {
    expect(queryText("Resumo")).toBe(
      "Resumo\nCategoria: Canais Digitais\nSubcategoria: App Mobile\nEmpresa: Banco Meridiano",
    );
  });

  it("draws the same mini map every time", () => {
    expect(miniMap()).toEqual(miniMap());
    for (const p of miniMap()) {
      for (const v of [p.sx, p.sy, p.tx, p.ty]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("texto e aula", () => {
  it("has no dashes and no real bank name", () => {
    for (const text of allCopy()) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/bradesco/i);
    }
  });

  it("keeps captions short and counts chapters", () => {
    expect(CHAPTERS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const ch of CHAPTERS) {
      const steps = lessonSteps(ch);
      expect(steps.length).toBe(ch.steps.length);
      for (const s of steps) expect(s.caption.length).toBeLessThanOrEqual(90);
      expect(steps[0].counter).toBe(`Capítulo ${ch.n} · Passo 1 de ${ch.steps.length}`);
    }
  });

  it("keeps modo aula on the way to the app", () => {
    expect(appHref("/recorrencias", false)).toBe("/recorrencias");
    expect(appHref("/recorrencias", true)).toBe("/recorrencias?aula=1");
    expect(appHref("/recorrencias?grupo=5", true)).toBe("/recorrencias?grupo=5&aula=1");
  });
});

describe("E2E rodada 2 P0-1: the search chapter never promises identity", () => {
  it("says it is one recorded run and why live results vary", () => {
    const ch = CHAPTERS.find((c) => c.id === "cap-4")!;
    expect(ch.note).not.toMatch(/os mesmos que o app/);
    expect(ch.note).toMatch(/uma execução/);
    expect(ch.note).toMatch(/resumo/);
  });
});
