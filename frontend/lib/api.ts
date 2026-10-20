import type { Change, ChangeSummary, EvaluateBody, Evaluation, Rubric } from "./changes";
import type { ProblemDetail, ProblemSummary } from "./problems";
import type {
  ClustersResponse,
  Health,
  IncidentDetail,
  IncidentListResponse,
  IncidentStateGroup,
  SuggestRequest,
  SuggestResponse,
} from "./types";

export interface IncidentQuery {
  state?: IncidentStateGroup;
  service?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

function buildQuery(params: IncidentQuery): string {
  const search = new URLSearchParams();
  if (params.state && params.state !== "all") search.set("state", params.state);
  if (params.service) search.set("service", params.service);
  if (params.q) search.set("q", params.q);
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** An API error that carries the HTTP status and the backend's detail message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

const CLIENT_ID_KEY = "incident-sense:client-id";
let memoryClientId: string | undefined;

/**
 * A random id for this browser, sent as X-Client-Id so the public demo can
 * meter AI calls per person even when a whole audience shares one network.
 */
export function clientId(): string {
  try {
    const stored = window.localStorage.getItem(CLIENT_ID_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode or blocked storage: keep one id for this page load.
    memoryClientId ??= Math.random().toString(36).slice(2);
    return memoryClientId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId(),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Não conseguimos falar com o servidor. Confira a conexão e tente de novo.",
    );
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new ApiError(
      response.status,
      detail ?? `O servidor respondeu com erro ${response.status}.`,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  getHealth: () => request<Health>("/api/health"),
  getClusters: () => request<ClustersResponse>("/api/clusters"),
  suggest: (body: SuggestRequest) =>
    request<SuggestResponse>("/api/suggest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listIncidents: (params: IncidentQuery = {}) =>
    request<IncidentListResponse>(`/api/incidents${buildQuery(params)}`),
  getIncident: (number: string) =>
    request<IncidentDetail>(`/api/incidents/${encodeURIComponent(number)}`),
  listProblems: () => request<ProblemSummary[]>("/api/problems"),
  getProblem: (number: string) =>
    request<ProblemDetail>(`/api/problems/${encodeURIComponent(number)}`),
  listChanges: () => request<ChangeSummary[]>("/api/changes"),
  getChange: (number: string) =>
    request<Change>(`/api/changes/${encodeURIComponent(number)}`),
  getRubric: () => request<Rubric>("/api/changes/rubric"),
  evaluateChange: (number: string, body: EvaluateBody) =>
    request<Evaluation>(`/api/changes/${encodeURIComponent(number)}/evaluate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export { buildQuery };
