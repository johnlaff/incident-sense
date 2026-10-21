import { describe, expect, it } from "vitest";

import { answerPlain, parseSuggestion } from "@/lib/answer";

const SAMPLE = `Os usuários estão presos na tela de login porque as sessões antigas continuam ativas [PRB0004105].

1. **Expirar as sessões antigas**: invalidar as sessões emitidas antes do deploy [PRB0004105].

2. **Tratar o token inválido no app**: renovar a sessão sozinho [PRB0004105], [INC0052219].`;

describe("parseSuggestion", () => {
  it("splits the sentence, the steps and the sources", () => {
    const a = parseSuggestion(SAMPLE);
    expect(a).not.toBeNull();
    expect(a!.oneLine).toBe(
      "Os usuários estão presos na tela de login porque as sessões antigas continuam ativas.",
    );
    expect(a!.oneLineCites).toEqual(["PRB0004105"]);
    expect(a!.steps).toHaveLength(2);
    expect(a!.steps[0].title).toBe("Expirar as sessões antigas");
    expect(a!.steps[0].text).toBe("invalidar as sessões emitidas antes do deploy.");
    expect(a!.steps[1].cites).toEqual(["PRB0004105", "INC0052219"]);
    expect(a!.steps[1].text).toBe("renovar a sessão sozinho.");
  });

  it("keeps at most five steps", () => {
    const many = ["Causa [INC0000001]."]
      .concat(Array.from({ length: 7 }, (_, i) => `${i + 1}. Passo ${i + 1}.`))
      .join("\n\n");
    const a = parseSuggestion(many)!;
    expect(a.steps).toHaveLength(5);
    expect(a.more).toBe(2);
  });

  it("gives up on text without steps", () => {
    expect(parseSuggestion("Só um parágrafo.")).toBeNull();
  });

  it("writes plain text for a note", () => {
    expect(answerPlain(parseSuggestion(SAMPLE)!)).toContain(
      "1. Expirar as sessões antigas: invalidar",
    );
  });
});

describe("comma citations (auditoria P1-6)", () => {
  it("reads both ids in one bracket and hides the bracket", () => {
    const parsed = parseSuggestion(
      "Sessões antigas com token inválido [PRB0004105].\n\n1. **Expirar sessões antigas**: forçar a renovação do token [INC0052180, PRB0004105]\n2. **Avisar**: avisar o cliente [INC0052181]",
    );
    expect(parsed?.steps[0].cites).toEqual(["INC0052180", "PRB0004105"]);
    expect(parsed?.steps[0].text).toBe("forçar a renovação do token");
  });
});

describe("Usar como nota keeps the sources (E2E P2-14)", () => {
  it("writes each step's records after it", () => {
    const text = answerPlain(parseSuggestion(SAMPLE)!);
    expect(text).toContain("[PRB0004105]");
    expect(text).toMatch(
      /renovar a sessão sozinho\. \[PRB0004105, INC0052219\]|renovar a sessão sozinho \[PRB0004105, INC0052219\]/,
    );
  });
});
