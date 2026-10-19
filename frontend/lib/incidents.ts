"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { api, ApiError } from "./api";
import type { ClustersResponse, IncidentDetail, IncidentListResponse } from "./types";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True once a request has been pending long enough to need an explanation. */
  slow: boolean;
  /** Run the request again without reloading the page. */
  retry: () => void;
}

/** After this long, a pending request explains itself (NN/g: feedback past ~1 s,
 *  an explanation once a wait heads toward 10 s). */
export const SLOW_AFTER_MS = 4000;

// The public API sleeps when idle and takes about a minute to wake. While it
// boots, the proxy answers 502-504 or the connection fails outright, so those
// are retried quietly a few times before the screen shows an error.
const WAKE_RETRIES = 6;
const WAKE_DELAY_MS = 5000;

function isWaking(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  // A 503 that carries the backend's own detail is a real answer, not a boot.
  if (error.status === 503) return error.detail.startsWith("O servidor respondeu");
  return [0, 502, 504].includes(error.status);
}

export function useAsync<T>(run: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<AsyncState<T>, "retry">>({
    data: null,
    loading: true,
    error: null,
    slow: false,
  });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Intentional fetch-in-effect: reset to loading, then commit asynchronously.
    setState({ data: null, loading: true, error: null, slow: false });
    const slowTimer = setTimeout(
      () => active && setState((s) => (s.loading ? { ...s, slow: true } : s)),
      SLOW_AFTER_MS,
    );

    const go = (left: number) => {
      run()
        .then((data) => {
          if (!active) return;
          clearTimeout(slowTimer);
          setState({ data, loading: false, error: null, slow: false });
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (left > 0 && isWaking(error)) {
            setState((s) => ({ ...s, slow: true }));
            timer = setTimeout(() => go(left - 1), WAKE_DELAY_MS);
            return;
          }
          clearTimeout(slowTimer);
          setState({
            data: null,
            loading: false,
            slow: false,
            error: error instanceof ApiError ? error.detail : "Erro inesperado.",
          });
        });
    };
    go(WAKE_RETRIES);

    return () => {
      active = false;
      clearTimeout(slowTimer);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
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
