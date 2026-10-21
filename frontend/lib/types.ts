// Types mirroring the backend API responses (keep in sync with the pydantic models).
// The copilot SSE wire types live in `copilot-stream.ts`, driven by the shared
// contract in contracts/copilot-stream/.

export type Classification = "PROCEDENTE" | "IMPROCEDENTE";

export interface ClusterPoint {
  id: string;
  x: number;
  y: number;
  cluster_id: number;
  cluster_label: string;
  is_outlier: boolean;
  short_description: string;
  priority: number;
}

export interface ClusterSummary {
  cluster_id: number;
  label: string;
  size: number;
}

export interface ClustersResponse {
  points: ClusterPoint[];
  clusters: ClusterSummary[];
  total: number;
  outliers: number;
}

export interface SuggestRequest {
  /** Incident in the base: step 1 loads it and step 7 publishes on it. */
  number?: string | null;
  short_description: string;
  description: string;
  category?: string | null;
  subcategory?: string | null;
  empresa?: string | null;
  cmdb_ci?: string | null;
  priority?: number | null;
  /** UI model id (see the model picker); the backend maps it to a real model. */
  model?: string | null;
}

export interface RetrievedCandidate {
  number: string;
  short_description: string;
  cmdb_ci: string;
  category: string;
  similarity: number;
  resolution_notes?: string | null;
  close_code?: string | null;
  survived_postfilter: boolean;
  postfilter_reason?: string | null;
}

export interface RetrievedProblem {
  number: string;
  short_description: string;
  root_cause: string;
  workaround: string;
  permanent_fix: string;
  linked_incidents: number;
  similarity: number;
  survived_postfilter: boolean;
  postfilter_reason?: string | null;
}

export type StepId =
  | "carregar"
  | "resumir"
  | "embedding"
  | "recuperar"
  | "contexto"
  | "decidir"
  | "sugerir"
  | "publicar";

export type StepStatus = "concluida" | "pulada" | "degradada";

export interface PipelineStep {
  id: StepId;
  order: number;
  title: string;
  status: StepStatus;
  decision: string;
  gate: boolean;
}

export type RecordKind = "incidente" | "problema";

export interface TagLayer {
  tags: string[];
  source: "incidente" | "ia" | "catalogo" | "nenhuma";
  filter_applied: boolean;
  decision: string;
}

export interface VectorHit {
  number: string;
  kind: RecordKind;
  short_description: string;
  similarity: number;
  passed: boolean;
}

export interface VectorLayer {
  min_similarity: number;
  incident_top_k: number;
  problem_top_k: number;
  incidents: VectorHit[];
  problems: VectorHit[];
  decision: string;
}

export interface PostFilterVerdict {
  number: string;
  kind: RecordKind;
  kept: boolean;
  reason: string;
}

export interface PostFilterLayer {
  status: "ok" | "fallback" | "sem_candidatos";
  verdicts: PostFilterVerdict[];
  fallback_reason?: string | null;
  decision: string;
}

export interface RetrievalTrace {
  tags: TagLayer;
  vector: VectorLayer;
  postfilter: PostFilterLayer;
}

export interface ProcedenciaDecision {
  classification: Classification;
  justification: string;
  generates_suggestion: boolean;
  decision: string;
}

export interface CitationFlag {
  id: string;
  action: "removida" | "sinalizada";
}

export interface CitationCheck {
  cited: string[];
  flagged: CitationFlag[];
}

/** A note the platform published on an incident's work notes (step 7). */
export interface WorkNote {
  id: string;
  incident_number: string;
  author: string;
  text: string;
  sources: string[];
  model: string | null;
  created_at: string;
}

export interface Publication {
  published: boolean;
  incident_number?: string | null;
  note?: WorkNote | null;
  decision: string;
}

export interface SuggestResponse {
  incident_number?: string | null;
  summarized_query: string;
  query_text: string;
  /** First values of the query vector, rounded (absent on older servers). */
  embedding_preview?: number[];
  /** Length of the query vector (absent on older servers). */
  dims?: number;
  classification: Classification;
  suggestion: string | null;
  candidates: RetrievedCandidate[];
  referenced_incidents: string[];
  problems: RetrievedProblem[];
  referenced_problems: string[];
  context_ids: string[];
  steps: PipelineStep[];
  retrieval: RetrievalTrace;
  decision: ProcedenciaDecision;
  citations: CitationCheck;
  publication: Publication;
}

/** A follow-up question about an analysis (POST /api/incidents/{n}/ask). */
export interface AskBody {
  question: string;
  /** The kept ids of the analysis: the only sources the answer may cite. */
  context_ids: string[];
  model?: string;
}

/** One follow-up answer. It is never published on the incident. */
export interface AskResponse {
  kind: "answer" | "not_in_cases" | "off_topic";
  answer: string;
  citations: CitationCheck;
  context_ids: string[];
}

export interface Health {
  status: string;
  version: string;
  llm_configured: boolean;
  embeddings_configured: boolean;
}

// ----- Incident browsing (mirrors the backend /api/incidents schemas) -----

export type IncidentStateGroup = "open" | "resolved" | "all";

export interface IncidentSummary {
  number: string;
  short_description: string;
  category: string;
  cmdb_ci: string;
  assignment_group: string;
  priority: number;
  state: string;
  opened_at: string;
  resolved_at: string | null;
  is_resolved: boolean;
  tags: string[];
}

export interface IncidentListResponse {
  total: number;
  items: IncidentSummary[];
  services: string[];
  open_count: number;
  resolved_count: number;
}

/** The full incident record served by GET /api/incidents/{number}. */
export interface IncidentDetail {
  number: string;
  short_description: string;
  description: string;
  category: string;
  subcategory: string;
  cmdb_ci: string;
  assignment_group: string;
  empresa: string;
  priority: number;
  impact: number;
  urgency: number;
  state: string;
  opened_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_notes: string | null;
  close_code: string | null;
  work_notes: string | null;
  tags: string[];
  // Recurrence cluster, joined server-side from the clustering result (nullable).
  cluster_id: number | null;
  cluster_label: string | null;
  is_outlier: boolean | null;
  /** Work notes the platform published (the AI suggestion, step 7). */
  published_notes: WorkNote[];
}
