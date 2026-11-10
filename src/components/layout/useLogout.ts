"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTakiStore } from "@/lib/store";
import { paths } from "@/lib/config/routes";
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

/** Returns a stable `logout()` that clears the demo session, goes to "/" and shows a toast. */
export function useLogout(): () => void {
  const router = useRouter();
  const logout = useTakiStore((s) => s.logout);
  const { toast } = useToast();

  return useCallback(() => {
    signingOut = true;
    router.replace(paths.home);
    logout();
    toast({ title: "You've been logged out", tone: "info" });
    // Safety net: release the flag once the navigation has had time to settle.
    window.setTimeout(clearSigningOut, 3000);
  }, [router, logout, toast]);
}
