// A complete SuggestResponse, shaped like the backend's, for the view-model tests.
import type { SuggestResponse } from "@/lib/types";

export function suggestFixture(
  overrides: Partial<SuggestResponse> = {},
): SuggestResponse {
  return {
    incident_number: "INC0053082",
    summarized_query: "Pix debitado sem comprovante por timeout",
    query_text:
      "Pix debitado sem comprovante por timeout\nCategoria: Pagamentos\nSubcategoria: Pix\nEmpresa: Banco Meridiano",
    classification: "PROCEDENTE",
    suggestion: "Aumentar workers [INC0051986] e reprocessar [PRB0004102].",
    candidates: [],
    referenced_incidents: ["INC0051986"],
    problems: [],
    referenced_problems: ["PRB0004102"],
    context_ids: ["INC0051986", "PRB0004102"],
    steps: [
      {
        id: "publicar",
        order: 7,
        title: "Publicação no incidente",
        status: "concluida",
        decision: "Publicada.",
        gate: false,
      },
      {
        id: "decidir",
        order: 5,
        title: "Incidente procedente?",
        status: "concluida",
        decision: "Procedente.",
        gate: true,
      },
      {
        id: "contexto",
        order: 5,
        title: "Contexto",
        status: "concluida",
        decision: "Contexto.",
        gate: false,
      },
      {
        id: "carregar",
        order: 1,
        title: "Carregar",
        status: "concluida",
        decision: "Carregado.",
        gate: false,
      },
    ],
    retrieval: {
      tags: {
        tags: ["pix", "timeout"],
        source: "incidente",
        filter_applied: true,
        decision: "Tags.",
      },
      vector: {
        min_similarity: 0.8,
        incident_top_k: 5,
        problem_top_k: 10,
        incidents: [
          {
            number: "INC0051986",
            kind: "incidente",
            short_description: "Pix pendente",
            similarity: 0.84,
            passed: true,
          },
          {
            number: "INC0051908",
            kind: "incidente",
            short_description: "Pix lento",
            similarity: 0.81,
            passed: true,
          },
          {
            number: "INC0051919",
            kind: "incidente",
            short_description: "Pix fora",
            similarity: 0.72,
            passed: false,
          },
        ],
        problems: [
          {
            number: "PRB0004102",
            kind: "problema",
            short_description: "Conciliação",
            similarity: 0.83,
            passed: true,
          },
        ],
        decision: "Vetor.",
      },
      postfilter: {
        status: "ok",
        verdicts: [
          { number: "INC0051986", kind: "incidente", kept: true, reason: "mesma causa" },
          { number: "INC0051908", kind: "incidente", kept: false, reason: "outra causa" },
          { number: "PRB0004102", kind: "problema", kept: true, reason: "causa raiz" },
        ],
        fallback_reason: null,
        decision: "Pós-filtro.",
      },
    },
    decision: {
      classification: "PROCEDENTE",
      justification: "falha real",
      generates_suggestion: true,
      decision: "Procedente.",
    },
    citations: { cited: ["INC0051986", "PRB0004102"], flagged: [] },
    publication: { published: false, decision: "Nada." },
    ...overrides,
  };
}
