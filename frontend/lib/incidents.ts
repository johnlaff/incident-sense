"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "./api";
import type { ClustersResponse, IncidentDetail, IncidentListResponse } from "./types";

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
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// The dataset is small (~431), so we fetch it whole once and filter/sort in the
// client for instant, ServiceNow-like interactions (segments, sort, search).
const ALL_LIMIT = 500;

/** Fetch the full incident repertoire plus global facets (counts, services). */
export function useAllIncidents(): AsyncState<IncidentListResponse> {
  return useAsync(() => api.listIncidents({ state: "all", limit: ALL_LIMIT }), []);
}

/** Fetch a single incident's full record (with its recurrence cluster). */
export function useIncident(number: string): AsyncState<IncidentDetail> {
  return useAsync(() => api.getIncident(number), [number]);
}

/** Fetch the committed recurrence-clustering result. */
export function useClusters(): AsyncState<ClustersResponse> {
  return useAsync(() => api.getClusters(), []);
}
