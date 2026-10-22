import type { Change, ChangeSummary, EvaluateBody, Evaluation, Rubric } from "./changes";
import type { ProblemDetail, ProblemSummary } from "./problems";
import type {
  AskBody,
  AskResponse,
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
  if (params.service) search.set("service", withoutAccents(params.service));
  if (params.q) search.set("q", withoutAccents(params.q));
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

/** An AI call (analysis, evaluation) gives up after this long. */
export const AI_TIMEOUT_MS = 90_000;
const TIMEOUT_DETAIL = "A IA demorou demais. Tente de novo.";

function aiSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(AI_TIMEOUT_MS)
    : undefined;
}

/** One FastAPI validation item (the 422 `detail` is a list of these). */
interface ValidationItem {
  type?: string;
  loc?: unknown[];
  ctx?: { max_length?: number };
}

/**
 * The sentence an error shows. The backend's own PT-BR detail passes; an
 * English framework default, a 422 list or any other shape becomes a
 * sentence, so a screen never gets an object to render (logica-4 P1-1).
 */
export function errorDetail(status: number, detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) {
    // A framework default in English is not a sentence (E2E-3 P2-17).
    const english =
      /^(Internal Server Error|Not Found|Bad Gateway|Service Unavailable|Gateway Timeout|Unprocessable (Entity|Content)|Method Not Allowed)$/i;
    if (!english.test(detail)) return detail;
  }
  if (Array.isArray(detail)) {
    const items = detail.filter(
      (d): d is ValidationItem => typeof d === "object" && d !== null,
    );
    const question = items.find((d) => d.loc?.includes("question"));
    if (question?.type === "string_too_long")
      return `A pergunta passou de ${question.ctx?.max_length ?? 600} caracteres. Encurte e envie de novo.`;
    if (question)
      return "O servidor não aceitou esta pergunta. Reescreva e envie de novo.";
    // Any other text past its limit (an edited Change field, a description).
    const long = items.find((d) => d.type === "string_too_long");
    if (long)
      return `O texto passou de ${long.ctx?.max_length ?? 6000} caracteres. Encurte e tente de novo.`;
    return `O servidor recusou os dados enviados (erro ${status}). Recarregue a página e tente de novo.`;
  }
  return `O servidor respondeu com erro ${status}. Tente de novo em instantes.`;
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
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    )
      throw new ApiError(408, TIMEOUT_DETAIL);
    throw new ApiError(
      0,
      "Não conseguimos falar com o servidor. Confira a conexão e tente de novo.",
    );
  }
  if (!response.ok) {
    const detail: unknown = await response
      .json()
      .then((body: { detail?: unknown }) => body.detail)
      .catch(() => undefined);
    throw new ApiError(response.status, errorDetail(response.status, detail));
  }
  return JSON.parse(withAccents(await response.text())) as T;
}

/**
 * The synthetic data writes team names the way ITSM tools store them, without
 * accents ("Sustentacao-Pagamentos"). On screen they read as Portuguese.
 */
const ACCENTS: [RegExp, string, string][] = [
  [/Sustentacao/g, "Sustentacao", "Sustentação"],
  [/Cartoes/g, "Cartoes", "Cartões"],
  [/Estacao/g, "Estacao", "Estação"],
  [/Integracoes/g, "Integracoes", "Integrações"],
];

export function withAccents(text: string): string {
  return ACCENTS.reduce((t, [re, , shown]) => t.replace(re, shown), text);
}

/** Back to the stored spelling, for a name sent to the API as a filter. */
export function withoutAccents(text: string): string {
  return ACCENTS.reduce((t, [, stored, shown]) => t.split(shown).join(stored), text);
}

export const api = {
  getHealth: () => request<Health>("/api/health"),
  getClusters: () => request<ClustersResponse>("/api/clusters"),
  suggest: (body: SuggestRequest) =>
    request<SuggestResponse>("/api/suggest", {
      method: "POST",
      body: JSON.stringify(body),
      signal: aiSignal(),
    }),
  askIncident: (number: string, body: AskBody) =>
    request<AskResponse>(`/api/incidents/${encodeURIComponent(number)}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: aiSignal(),
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
      signal: aiSignal(),
    }),
};

export { buildQuery };
