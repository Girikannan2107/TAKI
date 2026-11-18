"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { dashboardFor } from "@/lib/config/routes";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { Spinner } from "@/components/ui/Spinner";
import { useShellSession } from "./useShellSession";

export interface GuestOnlyProps {
  children: ReactNode;
}

function allowsSignedIn(): boolean {
  return new URLSearchParams(window.location.search).get("switch") === "1";
}

/**
 * Auth pages are for signed-out visitors. A signed-in user is sent to `?next` (if valid for their
 * role) or their dashboard — the same target the login/sign-up forms use, so the two never race.
 * `?switch=1` keeps the page open for a signed-in user (switching accounts).
 */
export function GuestOnly({ children }: GuestOnlyProps) {
  const { ready, signedIn, role } = useShellSession();
  const router = useRouter();
  const redirecting = ready && signedIn && !!role && typeof window !== "undefined" && !allowsSignedIn();

  useEffect(() => {
    if (!redirecting || !role) return;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeRedirect(next, role) ?? dashboardFor(role));
  }, [redirecting, role, router]);

  if (redirecting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-green-700">
        <Spinner size="lg" label="Redirecting to your dashboard" />
      </div>
    );
  }
  return <>{children}</>;
}
