"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfileDTO } from "@/lib/api/contracts/auth";
import { accountApi } from "@/lib/api/client/auth";
import { errorMessage } from "@/lib/api/http";

export type ProfileState<P extends ProfileDTO = ProfileDTO> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: P };

/**
 * GET /api/me/profile for the signed-in user. `reload()` re-fetches (keeps the current profile visible while
 * it does); `replace()` stores a profile the server already returned (e.g. PATCH result).
 */
export function useProfile<P extends ProfileDTO = ProfileDTO>() {
  const [state, setState] = useState<ProfileState<P>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    accountApi
      .profile()
      .then((p) => {
        if (!cancelled) setState({ status: "ready", profile: p as P });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(e, "We couldn't load your profile.") });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Re-fetch. After an error this shows the loading state again. */
  const reload = useCallback(() => {
    setState((s) => (s.status === "error" ? { status: "loading" } : s));
    setAttempt((n) => n + 1);
  }, []);

  const replace = useCallback((profile: P) => setState({ status: "ready", profile }), []);

  return { state, reload, replace };
}
