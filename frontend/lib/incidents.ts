"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "./api";
import type { IncidentDetail, IncidentListResponse, IncidentStateGroup } from "./types";

export const PAGE_SIZE = 25;

export interface IncidentFilters {
  state: IncidentStateGroup;
  service: string | null;
  q: string | null;
  page: number;
}

export const DEFAULT_FILTERS: IncidentFilters = {
  state: "all",
  service: null,
  q: null,
  page: 1,
};

/** Read filters from URL search params (pure; safe to unit-test). */
export function filtersFromParams(params: URLSearchParams): IncidentFilters {
  const rawState = params.get("state");
  const state: IncidentStateGroup =
    rawState === "open" || rawState === "resolved" ? rawState : "all";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  return {
    state,
    service: params.get("service") || null,
    q: params.get("q") || null,
    page,
  };
}

/** Serialize filters back to URL search params, omitting defaults. */
export function paramsFromFilters(filters: IncidentFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.state !== "all") params.set("state", filters.state);
  if (filters.service) params.set("service", filters.service);
  if (filters.q) params.set("q", filters.q);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useAsync<T>(run: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    let active = true;
    // Intentional fetch-in-effect: reset to loading, then commit asynchronously.
    /* eslint-disable react-hooks/set-state-in-effect */
    setState({ data: null, loading: true, error: null });
    run()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            data: null,
            loading: false,
            error: error instanceof ApiError ? error.detail : "Erro inesperado.",
          }),
      );
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Fetch a page of incidents for the current filters. */
export function useIncidentList(
  filters: IncidentFilters,
): AsyncState<IncidentListResponse> {
  return useAsync(
    () =>
      api.listIncidents({
        state: filters.state,
        service: filters.service,
        q: filters.q,
        limit: PAGE_SIZE,
        offset: (filters.page - 1) * PAGE_SIZE,
      }),
    [filters.state, filters.service, filters.q, filters.page],
  );
}

/** Fetch a single incident's full record. */
export function useIncident(number: string): AsyncState<IncidentDetail> {
  return useAsync(() => api.getIncident(number), [number]);
}
