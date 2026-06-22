import type { ClustersResponse, Health, SuggestRequest, SuggestResponse } from "./types";

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
};
