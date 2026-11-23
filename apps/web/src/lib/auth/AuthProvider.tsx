"use client";

import { useEffect, type ReactNode } from "react";
import { startAuthListener } from "@/features/auth/session";

/**
 * Subscribes the session store to the main Firebase Auth instance as soon as the app mounts, so the
 * session (restored from IndexedDB) is ready before any guard or shell asks for it. State is read with
 * `useAppSession()` / `useShellSession()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    startAuthListener();
  }, []);
  return <>{children}</>;
}
