// Types mirroring the backend API responses (keep in sync with the pydantic models).

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
  short_description: string;
  description: string;
  category?: string | null;
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

export interface SuggestResponse {
  summarized_query: string;
  classification: Classification;
  suggestion: string | null;
  candidates: RetrievedCandidate[];
  referenced_incidents: string[];
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
}
