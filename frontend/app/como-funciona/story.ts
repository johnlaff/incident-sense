// The "Como funciona" walkthrough as data: seven chapters of the lifecycle
// "depois do deploy" (Change, incident, recurrence, Problem and back), the
// modo aula captions, and the example values each animation draws.
//
// Every value is marked by where it comes from:
//  - DEMO: copied from the committed demo data or config (backend/data,
//    rubrica.toml, config.py) and checked by tests/como-funciona-story.test.ts;
//  - ENSAIO: what the demo returned in the talk rehearsal (roteiro-de-fala.md),
//    which can change with the model;
//  - ILUSTRATIVO: made up to explain the idea, and labelled so on screen.
// Pure module: no React, no DOM.

import type { AulaLessonStep } from "@/components/aula";

// ---------------------------------------------------------------------------
// Sources (the speakers' articles; cited by author and date only, the
// publisher stays out of the demo)
// ---------------------------------------------------------------------------

export const SOURCES = {
  solange: {
    label: "Artigo do Solange (08/10/2026)",
  },
  joao: {
    label: "Artigo do João (09/10/2026)",
  },
} as const;

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
 * ILUSTRATIVO: one grade per field for CHG0031002, chosen so the weighted
 * average is the 9,04 the Change got in the rehearsal (ENSAIO).
 */
export const EXAMPLE_GRADES: Record<string, number> = {
  implementation_plan: 9.2,
  validation_plan: 9,
  objective: 9.4,
  benefits: 8.6,
  test_justification: 9.2,
  short_description: 9,
  prerequisites: 8.6,
};

/** ILUSTRATIVO: seconds each judge call took, to show parallel versus queue. */
export const EXAMPLE_LATENCY: Record<string, number> = {
  implementation_plan: 1.9,
  validation_plan: 1.7,
  objective: 1.1,
  benefits: 1,
  test_justification: 1.4,
  short_description: 0.8,
  prerequisites: 0.9,
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

/** ENSAIO: the two Changes the gate splits in the demo script. */
export const GATE_EXAMPLES = [
  {
    number: "CHG0031003",
    title: "Ajuste no sistema",
    grade: 1,
    approx: true,
    verdict: "Para aqui: os campos ainda estão vazios ou genéricos.",
  },
  {
    number: "CHG0031002",
    title: "Boleto-Service 3.8.0",
    grade: 9.04,
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

/** ENSAIO: coherence grade CHG0031002 got in the rehearsal. */
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

export const CANDIDATES: Candidate[] = [
  {
    number: "PRB0004105",
    kind: "problema",
    title: "Sessões ativas inválidas após deploy mantêm clientes presos na tela de login",
    sim: 0.91,
    verdict: "mantido",
    reason: "Mesma causa: sessão aberta antes do deploy recebe token inválido.",
  },
  {
    number: "PRB0004104",
    kind: "problema",
    title: "Mudança no formato do token JWT quebra o login de versões antigas do app",
    sim: 0.88,
    verdict: "mantido",
    reason: "Token inválido depois de deploy: ajuda a descartar ou confirmar a causa.",
  },
  {
    number: "INC0052226",
    kind: "incidente",
    title: "Login falha com erro de token após atualização do app",
    sim: 0.87,
    verdict: "mantido",
    reason: "Mesmo erro de token, com a resolução registrada.",
  },
  {
    number: "INC0052177",
    kind: "incidente",
    title: "Problemas de login: token inválido após update",
    sim: 0.85,
    verdict: "mantido",
    reason: "Mesmo sintoma e mesma correção.",
  },
  {
    number: "INC0052273",
    kind: "incidente",
    title: "Dificuldade para logar no app após novo deploy",
    sim: 0.83,
    verdict: "descartado",
    reason: "Parece igual, mas a resolução foi limpar o cache de um aparelho só.",
  },
  {
    number: "INC0052223",
    kind: "incidente",
    title: "Problemas de sessão após atualização do app mobile",
    sim: 0.81,
    verdict: "descartado",
    reason: "Fala de sessão, mas sem erro de token: não ajuda neste caso.",
  },
  {
    number: "INC0052286",
    kind: "incidente",
    title: "Erro de login temporário em usuários do app mobile",
    sim: 0.76,
    verdict: "abaixo",
    reason: "",
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
  { text: "", cite: "INC0052226" },
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
  cx: number;
  cy: number;
  n: number;
}

export const MINI_GROUPS: MiniGroup[] = [
  { id: 2, label: "Falha de login no app após atualização", cx: 0.26, cy: 0.4, n: 13 },
  { id: 0, label: "Timeout em pagamentos Pix com débito", cx: 0.72, cy: 0.4, n: 11 },
  { id: 4, label: "Falha na geração de boletos", cx: 0.6, cy: 0.8, n: 9 },
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
  antes: { title: "Antes do deploy", who: "Parte do Solange" },
  depois: { title: "Depois do deploy", who: "Parte do João" },
  ciclo: { title: "O ciclo fecha", who: "Os dois juntos" },
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
    app: { href: "/changes/CHG0031001", label: "Ver no app: CHG0031001" },
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
        caption: "Com 8,0 ou mais a porta abre e a IA confere se os campos combinam.",
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
        line: "O autor vê o que ajustar antes de subir.",
        caption:
          "Completo não é coerente: a nota de coerência cai e o autor sabe o que ajustar.",
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
          "O resumo vira 3072 números. Textos com sentido parecido viram números parecidos.",
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
    app: { href: "/incidentes/INC0052233", label: "Ver no app: INC0052233" },
    steps: [
      {
        title: "Tags dizem onde procurar",
        line: "Só entra quem divide uma tag com o incidente.",
        caption: "Camada 1: as tags dizem em que parte do histórico procurar.",
        ms: 1500,
      },
      {
        title: "O vetor mede a semelhança",
        line: "Só entra quem passa de 0,80.",
        caption:
          "Camada 2: quanto mais perto de 1, mais parecido. Abaixo de 0,80 fica de fora.",
        ms: 1700,
      },
      {
        title: "Uma IA confere cada candidato",
        line: "Ela descarta o que só parece igual.",
        caption: "Camada 3: parecer não basta. A IA descarta o que não ajuda neste caso.",
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
    title: "Agrupar as recorrências",
    why: "Muitos incidentes, poucas causas: os parecidos formam grupos, e grupo grande pede um Problema.",
    app: { href: "/recorrencias", label: "Ver no app: Grupos" },
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
        title: "O HDBSCAN acha os grupos e deixa o resto de fora",
        line: "Caso isolado fica de fora.",
        caption: "O HDBSCAN acha os grupos densos. Caso isolado fica de fora, em cinza.",
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
    counter: `Capítulo ${ch.n} · ${i + 1} de ${ch.steps.length}`,
    durationMs: s.ms,
  }));
}

/** Every visible string of the story, for the copy checks in the tests. */
export function allCopy(): string[] {
  const out: string[] = [];
  for (const ch of CHAPTERS) {
    out.push(ch.title, ch.why, ch.app.label);
    for (const s of ch.steps) out.push(s.title, s.line, s.caption);
  }
  for (const p of Object.values(PARTS)) out.push(p.title, p.who);
  for (const c of CANDIDATES) out.push(c.title, c.reason);
  for (const t of CHG2_TASKS) out.push(t.text);
  for (const s of SUGGESTION) out.push(s.text);
  out.push(EXAMPLE_SUMMARY, PROBLEM.rootCause, PROBLEM.permanentFix, CHG2_BACKOUT);
  return out;
}
