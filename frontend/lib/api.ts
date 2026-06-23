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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Não foi possível conectar à API. Ela está rodando?");
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new ApiError(response.status, detail ?? `Erro ${response.status}`);
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
};

export { buildQuery };
