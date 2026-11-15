"use client";

import { useMemo } from "react";
import type { AppRole } from "@/lib/config/routes";
import { useAppSession } from "@/features/auth/session";

export interface ShellUser {
  name: string;
  avatarUrl?: string;
}

export interface ShellSession {
  /** False until the session source has loaded (render skeletons, never redirect, before this). */
  ready: boolean;
  signedIn: boolean;
  role: AppRole | null;
  user: ShellUser | null;
}

/**
 * The one place the shell (DashboardShell, RequireRole, TopBar, GuestOnly) reads "who is signed in":
 * the server session (GET /api/auth/session, httpOnly cookie).
 */
export function useShellSession(): ShellSession {
  const { status, user } = useAppSession();
  return useMemo(
    () => ({
      ready: status === "ready",
      signedIn: !!user,
      role: user?.role ?? null,
      user: user ? { name: user.name, avatarUrl: user.photoUrl ?? undefined } : null,
    }),
    [status, user],
  );
}
