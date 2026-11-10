"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { dashboardFor } from "@/lib/config/routes";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { useSession } from "@/lib/store/selectors";
import { Spinner } from "@/components/ui/Spinner";

export interface GuestOnlyProps {
  children: ReactNode;
}

/**
 * Auth pages are for signed-out visitors. A signed-in user is sent to `?next` (if valid for their
 * role) or their dashboard — the same target the login/sign-up forms use, so the two never race.
 */
export function GuestOnly({ children }: GuestOnlyProps) {
  const { hydrated, session, role } = useSession();
  const router = useRouter();
  const signedIn = hydrated && !!session && !!role;

  useEffect(() => {
    if (!signedIn || !role) return;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeRedirect(next, role) ?? dashboardFor(role));
  }, [signedIn, role, router]);

  if (signedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-green-700">
        <Spinner size="lg" label="Redirecting to your dashboard" />
      </div>
    );
  }
  return <>{children}</>;
}
