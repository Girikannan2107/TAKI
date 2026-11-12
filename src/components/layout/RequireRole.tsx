"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { dashboardFor, paths } from "@/lib/config/routes";
import { useSession } from "@/lib/store/selectors";
import { useToast } from "@/components/ui/useToast";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { clearSigningOut, isSigningOut } from "./useLogout";

export interface RequireRoleProps {
  role: Role;
  children: ReactNode;
  /** Rendered while hydrating / redirecting. Default <DashboardSkeleton />. */
  fallback?: ReactNode;
  /** Paths (exact, or as a "/prefix/" for sub-paths) that signed-out guests may open, e.g. public search. */
  guestPaths?: readonly string[];
}

function isGuestPath(pathname: string, guestPaths: readonly string[] | undefined): boolean {
  return Boolean(guestPaths?.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p)));
}

const roleNoun: Record<Role, string> = { customer: "customer", driver: "driver" };

/**
 * Client guard (UX only — demo session lives in localStorage).
 * Waits for store hydration, then: no session → /auth/login?next=<path+query>;
 * wrong role → own dashboard + info toast.
 */
export function RequireRole({ role, children, fallback, guestPaths }: RequireRoleProps) {
  const { hydrated, session, role: currentRole } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const handled = useRef<string | null>(null);

  const allowed = hydrated && ((!!session && currentRole === role) || (!session && isGuestPath(pathname, guestPaths)));

  useEffect(() => {
    if (!hydrated) return;
    if (allowed) {
      handled.current = null;
      clearSigningOut();
      return;
    }
    const key = `${pathname}|${currentRole ?? "none"}`;
    if (handled.current === key) return;
    handled.current = key;

    if (!session || !currentRole) {
      if (isSigningOut()) return;
      router.replace(paths.login(pathname + window.location.search));
      return;
    }
    router.replace(dashboardFor(currentRole));
    toast({
      tone: "info",
      title: `Signed in as a ${roleNoun[currentRole]}`,
      description: `Log out and sign in with a ${roleNoun[role]} account to open that page.`,
    });
  }, [hydrated, allowed, session, currentRole, role, pathname, router, toast]);

  if (!allowed) return <>{fallback ?? <DashboardSkeleton />}</>;
  return <>{children}</>;
}
