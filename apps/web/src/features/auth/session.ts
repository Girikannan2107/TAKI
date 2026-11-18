"use client";

import { useEffect, useSyncExternalStore } from "react";
import { onIdTokenChanged, signInWithCustomToken, signOut, type User } from "firebase/auth";
import type { AuthResultDTO, SessionUserDTO } from "@/lib/api/contracts/auth";
import { authApi } from "@/lib/api/client/auth";
import { isApiError, setUnauthenticatedHandler } from "@/lib/api/http";
import { firebaseConfigured, mainAuth } from "@/lib/firebase/client";

/**
 * "Who am I" for the browser (P2 §5.6). The MAIN Firebase Auth instance is the truth (its ID token is the
 * API Bearer); this store caches the matching `SessionUserDTO` from GET /api/v1/auth/session.
 *
 *  - `onIdTokenChanged` drives it: no Firebase user → `user: null`; a user → one session fetch per uid.
 *  - `claimsVersion` (from the API) ≠ the token's `v` claim → `getIdToken(true)` so routing claims are fresh.
 *  - Login / signup / reset / password change / phone change all return `AuthResultDTO`: call
 *    `signInWithAuthResult()` to swap the session in this tab (other tabs follow via persistence).
 *
 * Public shape (`useAppSession`, `setSessionUser`, `refreshSession`, `clearSession`) is unchanged from v2, so
 * `useShellSession`, `RequireRole`, `GuestOnly` and the shells did not change.
 */
export interface AppSessionState {
  /** "loading" until Firebase restored its state and the first session answer arrived. */
  status: "loading" | "ready";
  user: SessionUserDTO | null;
  /** Last load failed (network); user stays null. */
  error: boolean;
}

let state: AppSessionState = { status: "loading", user: null, error: false };
let inflight: Promise<SessionUserDTO | null> | null = null;
let started = false;
let currentUid: string | null = null;
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

async function syncClaims(fbUser: User, user: SessionUserDTO): Promise<void> {
  if (typeof user.claimsVersion !== "number") return;
  try {
    const res = await fbUser.getIdTokenResult();
    if (res.claims.v !== user.claimsVersion) await fbUser.getIdToken(true);
  } catch {
    // The next API call refreshes the token anyway.
  }
}

/** Re-reads the session from the API. Concurrent calls share one request. */
export function refreshSession(): Promise<SessionUserDTO | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!firebaseConfigured()) {
      emit({ status: "ready", user: null, error: false });
      return null;
    }
    const auth = mainAuth();
    await auth.authStateReady();
    const fbUser = auth.currentUser;
    if (!fbUser) {
      emit({ status: "ready", user: null, error: false });
      return null;
    }
    try {
      const { user } = await authApi.session();
      if (!user) {
        // The token is revoked or the account no longer exists: drop the stale Firebase session.
        await signOut(auth).catch(() => undefined);
        emit({ status: "ready", user: null, error: false });
        return null;
      }
      emit({ status: "ready", user, error: false });
      void syncClaims(fbUser, user);
      return user;
    } catch {
      emit({ status: "ready", user: null, error: true });
      return null;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Starts listening to the main Firebase instance once per page (AuthProvider / first useAppSession). */
export function startAuthListener(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!firebaseConfigured()) {
    emit({ status: "ready", user: null, error: false });
    return;
  }
  const auth = mainAuth();
  setUnauthenticatedHandler(() => {
    void signOut(auth).catch(() => undefined);
  });
  onIdTokenChanged(auth, (fbUser) => {
    const uid = fbUser?.uid ?? null;
    if (uid === currentUid && state.status === "ready") return; // token refresh, same account
    currentUid = uid;
    if (!fbUser) {
      emit({ status: "ready", user: null, error: false });
      return;
    }
    // Signed in elsewhere (another tab) or restored on load: fetch the profile for this uid.
    if (state.user?.id === uid) return;
    void refreshSession();
  });
}

/** After an AuthResultDTO (login, signup, reset, password or phone change): swap the session in. */
export async function signInWithAuthResult(result: AuthResultDTO): Promise<SessionUserDTO> {
  // Mark the incoming uid first so the token listener doesn't refetch what we already have.
  currentUid = result.user.id;
  emit({ status: "ready", user: result.user, error: false });
  const cred = await signInWithCustomToken(mainAuth(), result.customToken);
  void syncClaims(cred.user, result.user);
  return result.user;
}

/** After a profile change that returned the new user. */
export function setSessionUser(user: SessionUserDTO | null): void {
  emit({ status: "ready", user, error: false });
}

/** Signs this device out (`allDevices` also revokes every other session through E10 first). */
export async function signOutSession(allDevices = false): Promise<void> {
  if (allDevices) {
    try {
      await authApi.logout(true);
    } catch (e) {
      if (!isApiError(e) || e.status !== 401) throw e;
    }
  }
  if (firebaseConfigured()) await signOut(mainAuth()).catch(() => undefined);
  currentUid = null;
  emit({ status: "ready", user: null, error: false });
}

/** Local clear without a network call (kept for v2 callers). */
export function clearSession(): void {
  void signOutSession(false);
}

export function getSessionSnapshot(): AppSessionState {
  return state;
}

/** The signed-in user (or null). Starts the auth listener on first use. */
export function useAppSession(): AppSessionState & { refresh: () => Promise<SessionUserDTO | null> } {
  const snap = useSyncExternalStore(subscribe, getSessionSnapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    startAuthListener();
  }, []);
  return { ...snap, refresh: refreshSession };
}
