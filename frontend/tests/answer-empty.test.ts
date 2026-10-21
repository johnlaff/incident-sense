// Auditoria P1-7, P1-10, P2-14: the "no answer" card says why there is none.
import { describe, expect, it } from "vitest";

import { emptyAnswer } from "@/lib/answer";
import { suggestFixture } from "./suggest-fixture";

const base = suggestFixture();

describe("emptyAnswer", () => {
  it("says the AI checked and dropped every case past the floor", () => {
    const res = suggestFixture({
      suggestion: null,
      context_ids: [],
      retrieval: {
        ...base.retrieval,
        postfilter: {
          ...base.retrieval.postfilter,
          verdicts: base.retrieval.postfilter.verdicts.map((v) => ({
            ...v,
            kept: false,
          })),
        },
      },
    });
    const e = emptyAnswer(res);
    expect(e.kind).toBe("rejected");
    expect(e.line).toBe(
      "3 casos passaram da semelhança mínima, mas a IA conferiu e nenhum trata da mesma causa.",
    );
    expect(e.confidence).toBe(true);
  });

  it("keeps the floor sentence when nothing passed it", () => {
    const res = suggestFixture({
      suggestion: null,
      context_ids: [],
      retrieval: {
        ...base.retrieval,
        vector: {
          ...base.retrieval.vector,
          incidents: base.retrieval.vector.incidents.map((h) => ({
            ...h,
            passed: false,
          })),
          problems: [],
        },
        postfilter: {
          ...base.retrieval.postfilter,
          status: "sem_candidatos",
          verdicts: [],
        },
      },
    });
    expect(emptyAnswer(res).kind).toBe("below");
  });

  it("says the AI wrote nothing when it had cases", () => {
    const e = emptyAnswer(suggestFixture({ suggestion: null }));
    expect(e.kind).toBe("unwritten");
  });

  it("shows no confidence badge for a customer request", () => {
    const e = emptyAnswer(
      suggestFixture({ suggestion: null, classification: "IMPROCEDENTE" }),
    );
    expect(e.kind).toBe("improcedente");
    expect(e.confidence).toBe(false);
  });
});
