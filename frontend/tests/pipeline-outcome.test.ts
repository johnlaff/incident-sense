// E2E rodada 2 P1-1 and logica-2 P2-N8, P2-N12, P1-R2: the classification and
// the publication drive every word about suggestion, sources and note.
import { describe, expect, it } from "vitest";

import { emptyAnswer } from "@/lib/answer";
import { mapSuggest } from "@/lib/model";
import {
  PIPELINE_STEPS,
  analysisButton,
  beatsFor,
  humanLine,
  stepHint,
} from "@/lib/pipeline";
import { suggestFixture } from "./suggest-fixture";

const base = suggestFixture({ publication: { published: true, decision: "Publicada." } });
const improcedente = suggestFixture({
  classification: "IMPROCEDENTE",
  suggestion: null,
  context_ids: [],
  publication: { ...base.publication, published: false },
});
const rejected = suggestFixture({
  suggestion: null,
  context_ids: [],
  publication: { ...base.publication, published: false },
  retrieval: {
    ...base.retrieval,
    postfilter: {
      ...base.retrieval.postfilter,
      verdicts: base.retrieval.postfilter.verdicts.map((v) => ({ ...v, kept: false })),
    },
  },
});
const def = (key: string) => PIPELINE_STEPS.find((s) => s.key === key)!;
const caption = (res: typeof base, step: string) =>
  beatsFor(null, 0.8, res).find((b) => b.step === step)!.caption;

describe("analysis button", () => {
  it("offers the suggestion only when there is one", () => {
    expect(analysisButton(null)).toBe("Analisar com a IA");
    expect(analysisButton(base)).toBe("Ver a sugestão da IA");
    expect(analysisButton(improcedente)).toBe("Ver a análise da IA");
    expect(analysisButton(rejected)).toBe("Ver a análise da IA");
  });
});

describe("improcedente", () => {
  it("never asks to check sources that do not exist", () => {
    expect(humanLine(improcedente)).not.toMatch(/fontes/);
    expect(humanLine(base)).toMatch(/confira as fontes/);
  });

  it("step 7 never says it becomes a note", () => {
    expect(stepHint(def("publicar"), improcedente)).not.toMatch(/Vira nota/);
    expect(stepHint(def("sugerir"), improcedente)).not.toMatch(/cita/);
    expect(stepHint(def("publicar"), base)).toBe(def("publicar").hint);
  });

  it("modo aula captions for steps 6 and 7 follow the classification", () => {
    expect(caption(improcedente, "sugerir")).toMatch(/Improcedente/);
    expect(caption(improcedente, "publicar")).not.toMatch(
      /volta para o incidente como nota/,
    );
    expect(caption(base, "publicar")).toMatch(/volta para o incidente como nota/);
  });
});

describe("step 7 follows publication.published (P2-N12)", () => {
  it("says nothing was published when nothing was", () => {
    expect(caption(rejected, "publicar")).toMatch(/nada é publicado/);
  });
});

describe("assistant panel reads the same empty sentence (P1-R2)", () => {
  it("rejected: the panel says the AI ruled the cases out", () => {
    const view = mapSuggest(rejected);
    expect(view.empty?.line).toBe(emptyAnswer(rejected).line);
    expect(view.empty?.line).not.toMatch(/ainda não há um caso parecido/);
  });

  it("a suggestion has no empty line", () => {
    expect(mapSuggest(base).empty).toBeNull();
  });
});
