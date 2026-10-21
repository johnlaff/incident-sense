// The "Como funciona" walkthrough as data: seven chapters of the lifecycle
// "depois do deploy" (Change, incident, recurrence, Problem and back), the
// modo aula captions, and the example values each animation draws.
//
// Every value is marked by where it comes from:
//  - DEMO: copied from the committed demo data or config (backend/data,
//    rubrica.toml, config.py) and checked by tests/como-funciona-story.test.ts;
//  - REFERÊNCIA: what the demo returned in a real reference run with the model,
//    which can change with the model;
//  - ILUSTRATIVO: made up to explain the idea, and labelled so on screen.
// Pure module: no React, no DOM.

import type { AulaLessonStep } from "@/components/aula";

// ---------------------------------------------------------------------------
// References, cited the usual way: author and year in the text, the full
// entry (ABNT style) in the "Referências" list. The publisher stays out.
// ---------------------------------------------------------------------------

export interface Reference {
  /** Surname as cited in the text: "Ferreira (2026)". */
  author: string;
  year: number;
  /** The full entry, split so the title can be set in italics. */
  entry: { author: string; title: string; date: string };
}

export const SOURCES = {
  incidentes: {
    author: "Ferreira",
    year: 2026,
    entry: {
      author: "FERREIRA, João Lucas Assunção Fonseca.",
      title: "Sugestão de resolução de incidentes com IA",
      date: "out. 2026.",
    },
  },
  mudancas: {
    author: "Freitas Neto",
    year: 2026,
    entry: {
      author: "FREITAS NETO, Solange Brasileiro de.",
      title: "Como um LLM avalia texto escrito por humano",
      date: "out. 2026.",
    },
  },
} as const satisfies Record<string, Reference>;

/** The reference list, in alphabetical order of the entries. */
export const REFERENCES: Reference[] = Object.values(SOURCES).sort((a, b) =>
  a.entry.author.localeCompare(b.entry.author, "pt-BR"),
);

/** The full entry as plain text: "FERREIRA, João Lucas … out. 2026." */
export function referenceText(r: Reference): string {
  return `${r.entry.author} ${r.entry.title}. ${r.entry.date}`;
}

// ---------------------------------------------------------------------------
// Chapter 1: the Change gets a grade (DEMO rubric, ILUSTRATIVO field grades)
// ---------------------------------------------------------------------------

export interface RubricRow {
  key: string;
  label: string;
  /** Short label for narrow screens. */
  short: string;
  weight: number;
}

/** DEMO: backend/src/incident_sense/changes/rubrica.toml (version 2026-10-19). */
export const RUBRIC: RubricRow[] = [
  {
    key: "implementation_plan",
    label: "Plano de implementação",
    short: "Implementação",
    weight: 2.5,
  },
  {
    key: "validation_plan",
    label: "Plano de validação durante e após a implantação",
    short: "Validação",
    weight: 2.5,
  },
  { key: "objective", label: "Objetivo", short: "Objetivo", weight: 2 },
  { key: "benefits", label: "Benefícios", short: "Benefícios", weight: 2 },
  {
    key: "test_justification",
    label: "Justificativa dos testes",
    short: "Testes",
    weight: 2,
  },
  {
    key: "short_description",
    label: "Descrição resumida",
    short: "Descrição",
    weight: 1.5,
  },
  { key: "prerequisites", label: "Pré-requisitos", short: "Pré-requisitos", weight: 1 },
];

export const RUBRIC_VERSION = "2026-10-19";
/** DEMO: eligibility_threshold in rubrica.toml. */
export const GATE = 8;

export const TOTAL_WEIGHT = RUBRIC.reduce((s, r) => s + r.weight, 0);

/**
 * REAL: the grades CHG0031002 got in the app on 21/10/2026 (auditoria E2E),
 * so the explainer and the screen show the same 8,87. A new model run can
 * move a field by half a point.
 */
export const EXAMPLE_GRADES: Record<string, number> = {
  implementation_plan: 8.5,
  validation_plan: 8.5,
  objective: 9.5,
  benefits: 9,
  test_justification: 9,
  short_description: 8.5,
  prerequisites: 9.5,
};

/** REAL: the weighted average of EXAMPLE_GRADES, as the app shows it. */
export const CHG2_AVERAGE = 8.87;

/** REAL: the whole evaluation of CHG0031002 in the app, coherence included. */
export const REAL_EVAL_SECONDS = 8;

/**
 * ILUSTRATIVO: seconds each judge call took, to show parallel versus queue.
 * The slowest is under REAL_EVAL_SECONDS: the coherence check runs after.
 */
export const EXAMPLE_LATENCY: Record<string, number> = {
  implementation_plan: 6.2,
  validation_plan: 5.6,
  objective: 3.6,
  benefits: 3.3,
  test_justification: 4.6,
  short_description: 2.6,
  prerequisites: 3,
};

export interface Segment extends RubricRow {
  grade: number;
  /** grade x weight: the term in the formula. */
  product: number;
  /** How much of the 0..10 bar this field fills. */
  share: number;
  /** Where the segment starts on the 0..10 bar. */
  start: number;
}

/** The weighted average, built segment by segment (same math as evaluator.py). */
export function weightedSegments(
  grades: Record<string, number>,
  rubric: RubricRow[] = RUBRIC,
): { segments: Segment[]; average: number } {
  const total = rubric.reduce((s, r) => s + r.weight, 0);
  let start = 0;
  const segments = rubric.map((r) => {
    const grade = grades[r.key] ?? 0;
    const product = grade * r.weight;
    const share = product / total;
    const seg = { ...r, grade, product, share, start };
    start += share;
    return seg;
  });
  // evaluator.py rounds the overall grade to two places.
  const average = Math.round((start + Number.EPSILON) * 100) / 100;
  return { segments, average };
}

export function latencySummary(latency: Record<string, number> = EXAMPLE_LATENCY): {
  parallel: number;
  queue: number;
} {
  const values = Object.values(latency);
  return {
    parallel: Math.max(...values),
    queue: Math.round(values.reduce((s, v) => s + v, 0) * 10) / 10,
  };
}

/** PT-BR decimal comma with fixed places: 9.04 -> "9,04". */
export function br(value: number, places = 1): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** REAL: the two Changes the gate splits, with the averages the app gave. */
export const GATE_EXAMPLES = [
  {
    number: "CHG0031003",
    title: "Ajuste no sistema",
    grade: 1.17,
    approx: false,
    verdict: "Para aqui: os campos ainda estão vazios ou genéricos.",
  },
  {
    number: "CHG0031002",
    title: "Boleto-Service 3.8.0",
    grade: CHG2_AVERAGE,
    approx: false,
    verdict: "Segue para a análise de coerência.",
  },
] as const;

// ---------------------------------------------------------------------------
// Chapter 2: complete is not coherent (DEMO text of CHG0031002)
// ---------------------------------------------------------------------------

/** DEMO: excerpts of CHG0031002's implementation plan (backend/data/changes.json). */
export const CHG2_IMPLEMENTATION = [
  { text: "Pausar o consumidor de emissão de boletos.", touches: "operação" },
  {
    text: "ALTER TABLE boleto_titulo ADD COLUMN qr_code_payload, ADD COLUMN tipo_emissao",
    touches: "banco",
  },
  {
    text: "Job que atualiza os 1,9 milhão de boletos em aberto para HIBRIDO",
    touches: "banco",
  },
  {
    text: "Atualizar o deployment para a imagem boleto-service:3.8.0",
    touches: "imagem",
  },
] as const;

/** DEMO: CHG0031002's backout plan, verbatim. */
export const CHG2_BACKOUT =
  "Em caso de falha, reverter o deployment para a imagem anterior boleto-service:3.7.4 com kubectl rollout undo deployment/boleto-service. Tempo estimado: 5 minutos. Validar com a emissão de 5 boletos de teste.";

export type Coverage = "desfeita" | "sem-volta" | "operacao";

/**
 * DEMO tasks of CHG0031002. The coverage of each one by the backout plan is
 * ILUSTRATIVO: the app returns the coherence grade, the problems and an
 * adherence percentage, not a task-by-task mapping.
 */
export const CHG2_TASKS: { number: string; text: string; coverage: Coverage }[] = [
  {
    number: "CTASK003100201",
    text: "Pausar consumidor de emissão de boletos",
    coverage: "operacao",
  },
  {
    number: "CTASK003100202",
    text: "Executar migração Flyway V2026_10_29__boleto_hibrido.sql",
    coverage: "sem-volta",
  },
  {
    number: "CTASK003100203",
    text: "Rodar job de migração dos boletos em aberto para HIBRIDO",
    coverage: "sem-volta",
  },
  {
    number: "CTASK003100204",
    text: "Atualizar deployment para boleto-service:3.8.0",
    coverage: "desfeita",
  },
  {
    number: "CTASK003100205",
    text: "Retomar consumidor e emitir boletos de teste",
    coverage: "operacao",
  },
  {
    number: "CTASK003100206",
    text: "Rollback: kubectl rollout undo para boleto-service:3.7.4",
    coverage: "operacao",
  },
];

export const COVERAGE_LABEL: Record<Coverage, string> = {
  desfeita: "o retorno desfaz",
  "sem-volta": "nada desfaz",
  operacao: "passo de operação",
};

/** REFERÊNCIA: coherence grade CHG0031002 got in a real reference run. */
export const CHG2_COHERENCE = 4;

// ---------------------------------------------------------------------------
// Chapters 3 to 5: the incident (DEMO INC0052233, ILUSTRATIVO model outputs)
// ---------------------------------------------------------------------------

/** DEMO: backend/data/incidents.json. */
export const INCIDENT = {
  number: "INC0052233",
  title: "Dificuldades em logar no app após deploy recente",
  description:
    "Após o último deploy do aplicativo, vários usuários relataram problemas ao tentar entrar no sistema, muitos recebendo mensagens de erro sobre tokens inválidos. O problema é maior para aqueles que tinham sessões abertas anteriormente.",
  category: "Canais Digitais",
  subcategory: "App Mobile",
  empresa: "Banco Meridiano",
  tags: ["app-mobile", "login", "deploy"],
  workNote: "Acionado Maria Eduarda (Sustentação-Canais-Digitais) para análise.",
} as const;

/** ILUSTRATIVO: a summary like the one the model writes. */
export const EXAMPLE_SUMMARY =
  "Login no app falha com token inválido após deploy, sobretudo em sessões abertas antes.";

/** Same shape as build_query_text in backend/src/incident_sense/rag/pipeline.py. */
export function queryText(
  summary: string,
  inc: { category: string; subcategory: string; empresa: string } = INCIDENT,
): string {
  return `${summary}\nCategoria: ${inc.category}\nSubcategoria: ${inc.subcategory}\nEmpresa: ${inc.empresa}`;
}

export function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** DEMO: config.py. */
export const EMBEDDING = { model: "openai/text-embedding-3-large", dims: 3072 };
export const RETRIEVAL = { floor: 0.8, incidentTopK: 5, problemTopK: 10 };

/** Deterministic pseudo-random in [0, 1), so SSR and client agree. */
export function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** ILUSTRATIVO: the "fingerprint" bars, values in [-1, 1]. */
export function fingerprint(n = 48, seed = 7): number[] {
  return Array.from({ length: n }, (_, i) => {
    const v = seeded(seed * 31 + i) * 2 - 1;
    return Math.round(v * 100) / 100;
  });
}

/**
 * DEMO counts for layer 1: the knowledge base is the resolved incidents
 * (Resolved and Closed) plus the Problems; the filter keeps the records that
 * share at least one tag with INC0052233. Checked against backend/data.
 */
export const TAG_FUNNEL = {
  incidents: 326,
  problems: 10,
  matchIncidents: 33,
  matchProblems: 2,
};

export type Verdict = "mantido" | "descartado" | "abaixo";

export interface Candidate {
  number: string;
  kind: "incidente" | "problema";
  /** DEMO title of the record. */
  title: string;
  /** ILUSTRATIVO cosine similarity. */
  sim: number;
  verdict: Verdict;
  /** ILUSTRATIVO reason of the post-filter. */
  reason: string;
}

/**
 * The real neighbours of INC0052233 in the demo data (the app finds the same
 * seven): five incidents and two Problems, all about the JWT format changed
 * by a deploy. Similarities are rounded examples; the reasons quote each
 * record's own resolution.
 */
export const CANDIDATES: Candidate[] = [
  {
    number: "INC0052219",
    kind: "incidente",
    title: "Usuários impossibilitados de acessar o app após atualização",
    sim: 0.97,
    verdict: "mantido",
    reason: "Mesma causa: a validação do token mudou no deploy. Resolvido com rollback.",
  },
  {
    number: "INC0052228",
    kind: "incidente",
    title: "Clientes enfrentam erro de login após deploy no app",
    sim: 0.96,
    verdict: "mantido",
    reason: "O deploy mudou o formato do token JWT, como aqui.",
  },
  {
    number: "INC0052273",
    kind: "incidente",
    title: "Dificuldade para logar no app após novo deploy",
    sim: 0.96,
    verdict: "mantido",
    reason: "Mesmo sintoma e mesma correção: rollback e validação compatível.",
  },
  {
    number: "INC0052202",
    kind: "incidente",
    title: "Dificuldades de login relatadas após update do app",
    sim: 0.95,
    verdict: "mantido",
    reason: "Token com formato novo depois do deploy, com a solução registrada.",
  },
  {
    number: "INC0052209",
    kind: "incidente",
    title: "Problemas de login após implementação de novo deploy",
    sim: 0.95,
    verdict: "mantido",
    reason: "A versão anterior do app não aceitava o token novo: mesma causa.",
  },
  {
    number: "PRB0004105",
    kind: "problema",
    title: "Sessões ativas inválidas após deploy mantêm clientes presos na tela de login",
    sim: 0.93,
    verdict: "mantido",
    reason: "Mesma causa: sessão aberta antes do deploy recebe token inválido.",
  },
  {
    number: "PRB0004104",
    kind: "problema",
    title: "Mudança no formato do token JWT quebra o login de versões antigas do app",
    sim: 0.9,
    verdict: "mantido",
    reason: "Token inválido depois de deploy: ajuda a confirmar a causa.",
  },
];

export function funnel(cands: Candidate[] = CANDIDATES) {
  const passed = cands.filter((c) => c.sim >= RETRIEVAL.floor);
  const kept = passed.filter((c) => c.verdict === "mantido");
  return { found: cands.length, passed: passed.length, kept: kept.length };
}

/** Ruler position, 0..1 for 0,50..1,00 (same scale as lib/ruler.ts). */
export function rulerPos(sim: number): number {
  return Math.min(1, Math.max(0, (sim - 0.5) / 0.5));
}

/** DEMO: the self-service request in the demo data (tags demo, improcedente). */
export const IMPROCEDENTE = {
  number: "INC0053084",
  title: "Esqueci minha senha do internet banking",
};

/**
 * ILUSTRATIVO: a suggestion like the assistant's. The ids in brackets are citations;
 * INC0051234 never came from the search, so the check removes it.
 */
export const SUGGESTION: { text: string; cite?: string; removed?: boolean }[] = [
  { text: "Expirar de forma controlada as sessões abertas antes do deploy " },
  { text: "", cite: "PRB0004105" },
  { text: " e conferir se o formato do token mudou nesta versão " },
  { text: "", cite: "PRB0004104" },
  { text: ". Depois, pedir novo login aos clientes afetados " },
  { text: "", cite: "INC0052219" },
  { text: " e acompanhar a taxa de erro de token " },
  { text: "", cite: "INC0051234", removed: true },
  { text: "." },
];

// ---------------------------------------------------------------------------
// Chapter 6: recurrences (DEMO labels and totals, ILUSTRATIVO mini map)
// ---------------------------------------------------------------------------

/** DEMO: backend/data/precomputed/clusters.json. */
export const CLUSTERS_DEMO = { incidents: 431, groups: 9, isolated: 78 };

export interface MiniGroup {
  /** DEMO cluster id and label, for the color and the name. */
  id: number;
  label: string;
  /** The same short name the Repetições map shows (app/recorrencias/model.ts). */
  short: string;
  cx: number;
  cy: number;
  n: number;
}

export const MINI_GROUPS: MiniGroup[] = [
  {
    id: 2,
    label: "Falha de login no app após atualização",
    short: "Login no app",
    cx: 0.26,
    cy: 0.4,
    n: 13,
  },
  {
    id: 0,
    label: "Timeout em pagamentos Pix com débito",
    short: "Pix lento",
    cx: 0.72,
    cy: 0.4,
    n: 11,
  },
  {
    id: 4,
    label: "Falha na geração de boletos",
    short: "Boleto com falha",
    cx: 0.6,
    cy: 0.8,
    n: 9,
  },
];
export const MINI_ISOLATED = 7;

export interface MiniPoint {
  i: number;
  /** -1 for an isolated case. */
  group: number;
  /** Scattered start, 0..1. */
  sx: number;
  sy: number;
  /** Grouped end, 0..1. */
  tx: number;
  ty: number;
}

/** ILUSTRATIVO: a small, deterministic map of 40 incidents. */
export function miniMap(): MiniPoint[] {
  const pts: MiniPoint[] = [];
  let i = 0;
  for (const g of MINI_GROUPS) {
    for (let k = 0; k < g.n; k++) {
      const a = seeded(i * 3 + 1) * Math.PI * 2;
      const r = 0.035 + seeded(i * 3 + 2) * 0.085;
      pts.push({
        i,
        group: g.id,
        sx: 0.06 + seeded(i * 7 + 5) * 0.88,
        sy: 0.08 + seeded(i * 7 + 9) * 0.84,
        tx: g.cx + Math.cos(a) * r * 1.15,
        ty: g.cy + Math.sin(a) * r,
      });
      i++;
    }
  }
  const lonely = [
    [0.1, 0.78],
    [0.43, 0.12],
    [0.9, 0.55],
    [0.38, 0.6],
    [0.86, 0.9],
    [0.08, 0.1],
    [0.5, 0.92],
  ];
  for (const [x, y] of lonely.slice(0, MINI_ISOLATED)) {
    pts.push({
      i,
      group: -1,
      sx: 0.06 + seeded(i * 7 + 5) * 0.88,
      sy: 0.08 + seeded(i * 7 + 9) * 0.84,
      tx: x,
      ty: y,
    });
    i++;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Chapter 7: the loop closes (DEMO Problem record)
// ---------------------------------------------------------------------------

/** DEMO: backend/data/problems.json. */
export const PROBLEM = {
  number: "PRB0004105",
  title: "Sessões ativas inválidas após deploy mantêm clientes presos na tela de login",
  state: "Erro conhecido",
  linked: 17,
  rootCause:
    "As sessões emitidas antes do deploy não eram expiradas, e o app não tratava o erro de token inválido com uma renovação limpa.",
  permanentFix:
    "Tratamento de token inválido no app com renovação de sessão e expiração automática de sessões a cada mudança de chave.",
};

// ---------------------------------------------------------------------------
// The seven chapters and their steps
// ---------------------------------------------------------------------------

export type PartKey = "antes" | "depois" | "ciclo";

export const PARTS: Record<PartKey, { title: string; who: string }> = {
  antes: { title: "Antes do deploy", who: "com base em Freitas Neto (2026)" },
  depois: { title: "Depois do deploy", who: "com base em Ferreira (2026)" },
  ciclo: { title: "O ciclo fecha", who: "com base nas duas referências" },
};

export interface StoryStep {
  title: string;
  /** One plain line under the step title. */
  line: string;
  /** Modo aula caption, up to ~90 characters, no dashes. */
  caption: string;
  /** How long the step plays when "Reproduzir" runs outside modo aula. */
  ms: number;
}

export interface Chapter {
  id: string;
  n: number;
  part: PartKey;
  /** The one name of the chapter: heading, index and the line at the top. */
  title: string;
  why: string;
  /** One quiet line: which values on screen come from the demo, which are examples. */
  note: string;
  app: { href: string; label: string };
  steps: StoryStep[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: "cap-1",
    n: 1,
    part: "antes",
    title: "A nota da Mudança",
    why: "Antes de subir, a Mudança ganha uma nota. Ninguém revisa mil Mudanças por dia à mão.",
    note: "Pesos e corte vêm do demo; as notas são de uma avaliação real da CHG0031002; ao vivo elas podem mudar um pouco; os tempos são exemplos.",
    app: { href: "/changes/CHG0031002", label: "Ver no app: CHG0031002" },
    steps: [
      {
        title: "Sete campos, cada um com um peso",
        line: "Implementação e validação pesam mais.",
        caption:
          "Sete campos, cada um com um peso. Implementação e validação pesam mais.",
        ms: 1300,
      },
      {
        title: "Um juiz para cada campo, todos ao mesmo tempo",
        line: "Um campo bom não esconde outro vazio.",
        caption: "Uma IA juíza dá nota de 0 a 10 a cada campo, em paralelo.",
        ms: 1700,
      },
      {
        title: "As notas viram uma média ponderada",
        line: "Nota vezes peso, somadas, divididas por 13,5.",
        caption:
          "Campos mais importantes pesam mais. A média ponderada junta tudo numa nota só.",
        ms: 1700,
      },
      {
        title: "Campo que não mudou não volta ao juiz",
        line: "Editou um campo? Só ele volta ao modelo.",
        caption: "Trava de conteúdo: só o campo que mudou volta ao modelo.",
        ms: 1400,
      },
      {
        title: "Com 8,0 ou mais, abre a próxima análise",
        line: "Abaixo disso, falta preencher campo.",
        caption:
          "Com 8,0 ou mais a porta abre e a IA confere se os campos combinam, no mesmo corte.",
        ms: 1500,
      },
    ],
  },
  {
    id: "cap-2",
    n: 2,
    part: "antes",
    title: "Completo não é coerente",
    why: "Nota alta não quer dizer que os campos combinam: cada campo bom, e ainda assim sem volta segura.",
    note: "Textos da CHG0031002 do demo; a ligação de cada tarefa com o retorno é um exemplo.",
    app: { href: "/changes/CHG0031002", label: "Ver no app: CHG0031002" },
    steps: [
      {
        title: "A implementação mexe no banco de dados",
        line: "A CHG0031002 cria colunas e migra 1,9 milhão de boletos.",
        caption: "A implementação muda a tabela e migra 1,9 milhão de boletos.",
        ms: 1500,
      },
      {
        title: "O plano de retorno só volta a imagem",
        line: "Voltar o contêiner não desfaz a migração.",
        caption: "O retorno só volta a imagem do contêiner. O banco continua alterado.",
        ms: 1400,
      },
      {
        title: "A IA lê os campos juntos e confere as tarefas",
        line: "Compara o plano de retorno com cada tarefa.",
        caption: "A IA compara o plano de retorno com as tarefas cadastradas.",
        ms: 1600,
      },
      {
        title: "Coerência baixa, com o porquê",
        line: "Coerência abaixo de 8,0: não segue, e o autor vê o que ajustar.",
        caption:
          "Coerência abaixo de 8,0: a Mudança não segue, e o autor sabe o que ajustar.",
        ms: 1400,
      },
    ],
  },
  {
    id: "cap-3",
    n: 3,
    part: "depois",
    title: "Ler o incidente",
    why: "Quando quebra, a resposta quase sempre já está no histórico. O difícil é achar o caso certo.",
    note: "Chamado do demo; o resumo e os números são exemplos.",
    app: { href: "/incidentes/INC0052233", label: "Ver no app: INC0052233" },
    steps: [
      {
        title: "Carregar",
        line: "Título, descrição, categoria e tags.",
        caption:
          "Primeiro a IA lê o chamado: título, descrição, categoria, empresa e tags.",
        ms: 1300,
      },
      {
        title: "Resumir",
        line: "Um resumo curto busca melhor que o texto original.",
        caption:
          "O texto do usuário é bagunçado. A IA resume, e é o resumo que vai para a busca.",
        ms: 1500,
      },
      {
        title: "Transformar em números",
        line: "Textos de sentido parecido viram números parecidos.",
        caption:
          "O resumo vira 3.072 números. Textos com sentido parecido viram números parecidos.",
        ms: 1600,
      },
    ],
  },
  {
    id: "cap-4",
    n: 4,
    part: "depois",
    title: "Buscar e conferir",
    why: "Parecido não basta: primeiro buscar, depois conferir. Parecer não é o mesmo que servir.",
    note: "Casos de uma execução real do demo, com as semelhanças arredondadas. Ao vivo a ordem e as semelhanças podem mudar um pouco, e um caso pode trocar por outro, porque a IA reescreve o resumo do chamado a cada análise.",
    app: { href: "/incidentes/INC0052233", label: "Ver no app: INC0052233" },
    steps: [
      {
        title: "Tags dizem onde procurar",
        line: "Só entra quem divide uma tag com o incidente.",
        caption: "Camada 1: as tags dizem em que parte do histórico procurar.",
        ms: 1500,
      },
      {
        title: "Os números medem a semelhança",
        line: "De 0 a 1. Só entra quem passa de 0,80.",
        caption:
          "Camada 2: quanto mais perto de 1, mais parecido. Abaixo de 0,80 fica de fora.",
        ms: 1700,
      },
      {
        title: "Uma IA confere cada candidato",
        line: "Ela descarta o que só parece igual. Aqui, os 7 servem.",
        caption:
          "Camada 3: a IA lê cada caso e descarta o que só parece igual. Aqui, os 7 servem.",
        ms: 1600,
      },
    ],
  },
  {
    id: "cap-5",
    n: 5,
    part: "depois",
    title: "Decidir e responder",
    why: "Decidir antes de escrever, e mostrar as fontes. Sugestão sem fonte é palpite.",
    note: "Registros do demo; o texto da sugestão e a nota são exemplos.",
    app: { href: "/incidentes/INC0052233", label: "Ver no app: INC0052233" },
    steps: [
      {
        title: "Classificar",
        line: "Se não é falha técnica, não há sugestão.",
        caption:
          "É falha técnica? Se não for, a IA não sugere nada. Saber não responder é resposta.",
        ms: 1500,
      },
      {
        title: "Sugerir, citando as fontes",
        line: "Só cita casos da busca. O resto sai.",
        caption: "A sugestão só cita casos que passaram pela busca. Citação de fora sai.",
        ms: 1700,
      },
      {
        title: "Publicar no incidente",
        line: "Vira nota no incidente. A pessoa decide.",
        caption:
          "A sugestão volta para o incidente como nota. Quem decide é a pessoa analista.",
        ms: 1400,
      },
    ],
  },
  {
    id: "cap-6",
    n: 6,
    part: "depois",
    title: "Agrupar as repetições",
    why: "Muitos incidentes, poucas causas: os parecidos formam grupos, e grupo grande pede um Problema.",
    note: "Mapa de exemplo, com os nomes de grupos do demo.",
    app: { href: "/recorrencias", label: "Ver no app: Repetições" },
    steps: [
      {
        title: "Cada incidente é um ponto",
        line: "Os mesmos números da busca.",
        caption: "Cada incidente vira um ponto, usando os mesmos números da busca.",
        ms: 1200,
      },
      {
        title: "Os parecidos ficam perto",
        line: "Duas dimensões, só para desenhar.",
        caption: "Incidentes com sentido parecido ficam perto uns dos outros.",
        ms: 1500,
      },
      {
        title: "Um algoritmo acha os grupos e deixa o resto de fora",
        line: "Onde há muitos pontos juntos, há um grupo. Caso isolado fica de fora.",
        caption:
          "O algoritmo acha onde há muitos pontos juntos. Caso isolado fica cinza.",
        ms: 1500,
      },
      {
        title: "A IA dá nome a cada grupo",
        line: "Um rótulo curto por grupo.",
        caption: "A IA lê cada grupo e dá um nome curto para o padrão.",
        ms: 1300,
      },
      {
        title: "Um grupo vira um Problema",
        line: "O Problema investiga a causa da repetição.",
        caption:
          "Um grupo vira um Problema: o registro que investiga a causa da repetição.",
        ms: 1300,
      },
    ],
  },
  {
    id: "cap-7",
    n: 7,
    part: "ciclo",
    title: "O Problema fecha o ciclo",
    why: "A correção vira Mudança, e a resposta vira fonte.",
    note: "Problema do demo; a semelhança mostrada é um exemplo.",
    app: { href: "/problemas/PRB0004105", label: "Ver no app: PRB0004105" },
    steps: [
      {
        title: "O Problema guarda a causa",
        line: "O PRB0004105 junta 17 incidentes de login.",
        caption: "O Problema junta os incidentes repetidos e registra a causa raiz.",
        ms: 1400,
      },
      {
        title: "A correção definitiva vira uma Mudança",
        line: "Ela passa pelo mesmo juiz do capítulo 1.",
        caption: "A correção vira uma nova Mudança, que passa pelo mesmo juiz do começo.",
        ms: 1600,
      },
      {
        title: "O que foi resolvido vira fonte",
        line: "O próximo incidente parecido já acha este.",
        caption:
          "O Problema entra na busca: o próximo incidente parecido já acha a resposta.",
        ms: 1500,
      },
    ],
  },
];

/** Modo aula steps for one chapter. */
export function lessonSteps(ch: Chapter): AulaLessonStep[] {
  return ch.steps.map((s, i) => ({
    title: s.title,
    caption: s.caption,
    counter: `Capítulo ${ch.n} · Passo ${i + 1} de ${ch.steps.length}`,
    durationMs: s.ms,
  }));
}

/** Every visible string of the story, for the copy checks in the tests. */
export function allCopy(): string[] {
  const out: string[] = [];
  for (const ch of CHAPTERS) {
    out.push(ch.title, ch.why, ch.note, ch.app.label);
    for (const s of ch.steps) out.push(s.title, s.line, s.caption);
  }
  for (const p of Object.values(PARTS)) out.push(p.title, p.who);
  for (const c of CANDIDATES) out.push(c.title, c.reason);
  for (const t of CHG2_TASKS) out.push(t.text);
  for (const s of SUGGESTION) out.push(s.text);
  out.push(EXAMPLE_SUMMARY, PROBLEM.rootCause, PROBLEM.permanentFix, CHG2_BACKOUT);
  return out;
}
