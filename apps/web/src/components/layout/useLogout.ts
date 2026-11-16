"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { paths } from "@/lib/config/routes";
import { signOutSession } from "@/features/auth/session";
import { useToast } from "@/components/ui/useToast";

/**
 * Module flag read by RequireRole: while a deliberate sign-out navigates home, the guard must not
 * bounce the user to /auth/login?next=… for the page they just left.
 */
let signingOut = false;
export function isSigningOut(): boolean {
  return signingOut;
}
export function clearSigningOut(): void {
  signingOut = false;
}

export interface LogoutOptions {
  /** false = no toast (e.g. the caller shows its own). Default true. */
  toast?: boolean;
  /** Custom toast title instead of "You've been logged out". Ignored when `toast` is false. */
  message?: string;
  /** Also revoke every other session (E10 `allDevices: true`). Default false (this device only). */
  allDevices?: boolean;
}

/**
 * `logout()` / `logout({ toast: false })` / `logout({ message: "…" })`.
 * Also accepts (and ignores) a React event, so `onClick={logout}` keeps working.
 */
export type LogoutFn = (options?: LogoutOptions | { nativeEvent: Event }) => void;

function readOptions(arg: unknown): LogoutOptions {
  if (!arg || typeof arg !== "object" || "nativeEvent" in arg || arg instanceof Event) return {};
  return arg as LogoutOptions;
}

/** Returns a stable `logout()`: signs Firebase out (and optionally every device), goes to "/" and (by default) toasts. */
export function useLogout(): LogoutFn {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(
    (options) => {
      const { toast: showToast = true, message, allDevices = false } = readOptions(options);
      signingOut = true;
      void signOutSession(allDevices)
        .catch(() => {
          // "Everywhere" failed (offline): this device is still signed out below.
          return signOutSession(false);
        })
        .finally(() => {
          router.replace(paths.home);
          router.refresh();
          if (showToast) toast({ title: message ?? "You've been logged out", tone: "info" });
          // Safety net: release the flag once the navigation has had time to settle.
          window.setTimeout(clearSigningOut, 3000);
        });
    },
    [router, toast],
  );
}
