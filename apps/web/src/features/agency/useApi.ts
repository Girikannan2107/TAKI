"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/lib/api/http";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; code: string | null }
  | { status: "ready"; data: T };

interface Stored<T> {
  key: string;
  attempt: number;
  state: ApiState<T>;
}

/**
 * Minimal data hook for agency screens: `useApi(key, fetcher)` loads when `key` changes (e.g. the tab or
 * query string) and exposes `reload()` (keeps showing the current data while refetching) and `setData()`
 * for optimistic/server-returned updates. Results for a stale key are dropped.
 */
export function useApi<T>(key: string, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<Stored<T>>({ key: "", attempt: -1, state: { status: "loading" } });

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setStored({ key, attempt, state: { status: "ready", data } });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setStored({ key, attempt, state: { status: "error", message: errorMessage(e, "We couldn't load this. Please try again."), code: e instanceof ApiError ? e.code : null } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  // A different key means we're loading new data: never show the previous key's result.
  const state: ApiState<T> = stored.key === key ? stored.state : { status: "loading" };
  const reloading = stored.key === key && stored.attempt !== attempt;

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((data: T) => setStored((s) => ({ key: s.key, attempt: s.attempt, state: { status: "ready", data } })), []);

  return { state, reload, reloading, setData };
}
