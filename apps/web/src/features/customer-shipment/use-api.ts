"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isApiError } from "@/lib/api/http";

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first response for the current key (not during background reloads). */
  loading: boolean;
  /** Background refresh in flight (data stays visible). */
  refreshing: boolean;
  reload: () => Promise<void>;
  /** Replace the cached data (e.g. with a mutation's response). */
  setData: (next: T) => void;
}

/**
 * Minimal fetch-on-mount hook (P2 §8.9: plain fetch in small hooks). `key` null = skip.
 * A key change aborts the previous request; stale responses are ignored.
 */
export function useApi<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): ApiState<T> {
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: unknown; loading: boolean; refreshing: boolean }>({
    key,
    data: undefined,
    error: undefined,
    loading: key !== null,
    refreshing: false,
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(
    async (background: boolean) => {
      if (key === null) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const mine = ++seq.current;
      setState((s) => (background && s.key === key ? { ...s, refreshing: true } : { key, data: s.key === key ? s.data : undefined, error: undefined, loading: true, refreshing: false }));
      try {
        const data = await fetcherRef.current(c.signal);
        if (mine === seq.current) setState({ key, data, error: undefined, loading: false, refreshing: false });
      } catch (e) {
        if (c.signal.aborted || mine !== seq.current) return;
        setState((s) => ({ key, data: background ? s.data : undefined, error: e, loading: false, refreshing: false }));
      }
    },
    [key],
  );

  useEffect(() => {
    void run(false);
    return () => ctrl.current?.abort();
  }, [run]);

  const reload = useCallback(() => run(true), [run]);
  const setData = useCallback((next: T) => setState((s) => ({ ...s, data: next, error: undefined, loading: false })), []);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: key !== null && (!current || state.loading),
    refreshing: current && state.refreshing,
    reload,
    setData,
  };
}

/** Re-run `reload` every `ms` while the tab is visible and `enabled` is true. */
export function usePolling(reload: () => Promise<void> | void, ms: number, enabled: boolean): void {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void ref.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

export function isNotFound(e: unknown): boolean {
  return isApiError(e) && (e.status === 404 || e.code === "not_found");
}

export function isUnauthenticated(e: unknown): boolean {
  return isApiError(e) && e.status === 401;
}
