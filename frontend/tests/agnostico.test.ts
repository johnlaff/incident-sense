// The demo is used in many presentations and classes: no screen names an
// event or a talk, and the sources are cited as references (author, year).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PARTS,
  REFERENCES,
  SOURCES,
  allCopy,
  referenceText,
} from "@/app/como-funciona/story";

const EVENT =
  /techweek|devfest|iftm|\bufu\b|facom|palestra|palestrante|roteiro-de-fala|\bthe talk\b|\ba talk\b/i;
/** The talk's title (the phrase "depois do deploy" itself is fine). */
const TALK_TITLE = /Depois do Deploy/;
const FIRST_NAME_CITE = /artigo d[oea] (jo[aã]o|solange)|jo[aã]o's|solange's|article by/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("no event or talk on screen or in the code", () => {
  const root = join(__dirname, "..");
  const files = ["app", "components", "lib"].flatMap((d) => sources(join(root, d)));

  it("no source file names an event, a talk or a first-name article", () => {
    const hits = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return EVENT.test(text) || TALK_TITLE.test(text) || FIRST_NAME_CITE.test(text);
    });
    expect(hits).toEqual([]);
  });

  it("the walkthrough copy cites references, not speakers", () => {
    const copy = allCopy().join("\n");
    expect(copy).not.toMatch(EVENT);
    expect(copy).not.toMatch(TALK_TITLE);
    expect(copy).not.toMatch(FIRST_NAME_CITE);
    expect(PARTS.antes.who).toBe("com base em Freitas Neto (2026)");
    expect(PARTS.depois.who).toBe("com base em Ferreira (2026)");
  });
});

describe("the references are listed the standard way", () => {
  it("author-year in the text and full entries in alphabetical order", () => {
    expect(`${SOURCES.incidentes.author} (${SOURCES.incidentes.year})`).toBe(
      "Ferreira (2026)",
    );
    expect(REFERENCES.map(referenceText)).toEqual([
      "FERREIRA, João Lucas Assunção Fonseca. Sugestão de resolução de incidentes com IA. out. 2026.",
      "FREITAS NETO, Solange Brasileiro de. Como um LLM avalia texto escrito por humano. out. 2026.",
    ]);
  });

  it("no reference names a publisher or a link", () => {
    for (const r of REFERENCES)
      expect(referenceText(r)).not.toMatch(/https?:|www\.|banco/i);
  });
});
