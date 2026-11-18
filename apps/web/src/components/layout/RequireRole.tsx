"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dashboardFor, loginFor, type AppRole } from "@/lib/config/routes";
import { useToast } from "@/components/ui/useToast";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { clearSigningOut, isSigningOut } from "./useLogout";
import { useShellSession } from "./useShellSession";

export interface RequireRoleProps {
  /** The role (or roles) allowed to see the children. */
  role: AppRole | readonly AppRole[];
  children: ReactNode;
  /** Rendered while loading / redirecting. Default <DashboardSkeleton />. */
  fallback?: ReactNode;
  /** Paths (exact, or as a "/prefix/" for sub-paths) that signed-out guests may open, e.g. public search. */
  guestPaths?: readonly string[];
}

function isGuestPath(pathname: string, guestPaths: readonly string[] | undefined): boolean {
  return Boolean(guestPaths?.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p)));
}

const roleNoun: Record<AppRole, string> = { customer: "customer", agency: "travel agency", driver: "driver", admin: "admin" };
const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

/**
 * Client guard (UX only — FastAPI verifies the token, role and ownership on every request).
 * Waits for the session, then: no session → that role's login with ?next=<path+query>;
 * wrong role → own dashboard + info toast.
 */
export function RequireRole({ role, children, fallback, guestPaths }: RequireRoleProps) {
  const { ready, signedIn, role: currentRole } = useShellSession();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const handled = useRef<string | null>(null);
  const roles: readonly AppRole[] = typeof role === "string" ? [role] : role;
  const primary = roles[0]!;

  const allowed =
    ready && ((signedIn && !!currentRole && roles.includes(currentRole)) || (!signedIn && isGuestPath(pathname, guestPaths)));

  useEffect(() => {
    if (!ready) return;
    if (allowed) {
      handled.current = null;
      clearSigningOut();
      return;
    }
    const key = `${pathname}|${currentRole ?? "none"}`;
    if (handled.current === key) return;
    handled.current = key;

    if (!signedIn || !currentRole) {
      if (isSigningOut()) return;
      router.replace(loginFor(primary, pathname + window.location.search));
      return;
    }
    router.replace(dashboardFor(currentRole));
    const want = roleNoun[primary];
    toast({
      tone: "info",
      title: `Signed in as ${article(roleNoun[currentRole])} ${roleNoun[currentRole]}`,
      description: `Log out and sign in with ${article(want)} ${want} account to open that page.`,
    });
  }, [ready, allowed, signedIn, currentRole, primary, pathname, router, toast]);

  if (!allowed) return <>{fallback ?? <DashboardSkeleton />}</>;
  return <>{children}</>;
}
