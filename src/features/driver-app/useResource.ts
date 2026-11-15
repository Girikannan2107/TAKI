"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "@/lib/api/http";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; code: string | null }
  | { status: "ready"; data: T };

type Stored<T> = { key: string; attempt: number; state: ResourceState<T> } | null;

/**
 * Loads one API resource with an AbortSignal. Changing `key` shows the loading state again;
 * `reload()` refetches while keeping the current data visible; `replace()` stores a value the
 * server just returned (e.g. a transition result) without refetching.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [stored, setStored] = useState<Stored<T>>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    loadRef
      .current(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setStored({ key, attempt, state: { status: "ready", data } });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setStored({
          key,
          attempt,
          state: {
            status: "error",
            message: errorMessage(e, "We couldn't load this. Check your connection and try again."),
            code: isApiError(e) ? e.code : null,
          },
        });
      });
    return () => ctrl.abort();
  }, [key, attempt]);

  // Stale data from another key is never shown; data for this key stays visible during a reload,
  // but a previous error turns back into the loading state.
  let state: ResourceState<T> = { status: "loading" };
  if (stored && stored.key === key && !(stored.state.status === "error" && stored.attempt !== attempt)) state = stored.state;

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback((data: T) => setStored((s) => ({ key: s?.key ?? key, attempt: s?.attempt ?? 0, state: { status: "ready", data } })), [key]);

  return { state, reload, replace };
}
