import { aulaFromQuery } from "./aula-machine";

/**
 * Where the root URL sends a visitor. A lesson link (/?aula=1) opens the
 * lesson start page; anything else opens the incident queue. The query string
 * always travels along, so modo aula and any other flag survive the redirect.
 */
export function homeTarget(
  params: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      search.append(key, v);
    }
  }
  const query = search.toString();
  const base = aulaFromQuery(query ? `?${query}` : "") === true ? "/aula" : "/incidentes";
  return query ? `${base}?${query}` : base;
}
