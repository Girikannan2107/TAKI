"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SessionUserDTO } from "@/lib/api/contracts/auth";
import { authApi } from "@/lib/api/client/auth";

/**
 * Browser view of the server session (GET /api/auth/session). One module-level store shared by the shell,
 * guards and pages. The httpOnly cookie is the truth; this is only a cache of "who am I".
 */
export interface AppSessionState {
  /** "loading" until the first /api/auth/session answer (or an explicit set). */
  status: "loading" | "ready";
  user: SessionUserDTO | null;
  /** Last load failed (network); user stays null. */
  error: boolean;
}

let state: AppSessionState = { status: "loading", user: null, error: false };
let inflight: Promise<SessionUserDTO | null> | null = null;
let loadedOnce = false;
const listeners = new Set<() => void>();

const SERVER_SNAPSHOT: AppSessionState = { status: "loading", user: null, error: false };

function emit(next: AppSessionState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-reads the session from the server. Concurrent calls share one request. */
export function refreshSession(): Promise<SessionUserDTO | null> {
  if (inflight) return inflight;
  inflight = authApi
    .session()
    .then((r) => {
      loadedOnce = true;
      emit({ status: "ready", user: r.user, error: false });
      return r.user;
    })
    .catch(() => {
      loadedOnce = true;
      emit({ status: "ready", user: null, error: true });
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** After login / signup / profile change: the server already returned the user. */
export function setSessionUser(user: SessionUserDTO | null): void {
  loadedOnce = true;
  emit({ status: "ready", user, error: false });
}

/** After logout. */
export function clearSession(): void {
  setSessionUser(null);
}

export function getSessionSnapshot(): AppSessionState {
  return state;
}

/** The signed-in user (or null). Loads the session on first use. */
export function useAppSession(): AppSessionState & { refresh: () => Promise<SessionUserDTO | null> } {
  const snap = useSyncExternalStore(subscribe, getSessionSnapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    if (!loadedOnce) void refreshSession();
  }, []);
  return { ...snap, refresh: refreshSession };
}
