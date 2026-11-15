"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { isPublicRole, PUBLIC_ROLES, type PublicRole } from "@/lib/config/routes";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import type { AuthFlowKind } from "./flow-store";

export function parseFlow(value: string | null | undefined): AuthFlowKind | null {
  return value === "signup" || value === "reset" ? value : null;
}

export function parseRole(value: string | null | undefined): PublicRole | undefined {
  return isPublicRole(value) ? value : undefined;
}

/**
 * Keep `?next` only if it could be a valid return path for some role. The final redirect still
 * re-checks it against the signed-in role with `safeRedirect(next, role)`.
 */
export function sanitizeNext(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return PUBLIC_ROLES.some((r) => safeRedirect(value, r)) ? value : undefined;
}

export interface AuthQuery {
  /** Flow from `?flow` (null when absent/invalid). */
  flowParam: AuthFlowKind | null;
  /** `?flow` with the route-contract default ("signup"). */
  flow: AuthFlowKind;
  role: PublicRole | undefined;
  next: string | undefined;
}

/** Parsed auth-flow query (`flow`, `role`, `next`). Needs a <Suspense> boundary above it. */
export function useAuthQuery(): AuthQuery {
  const params = useSearchParams();
  const flowRaw = params.get("flow");
  const roleRaw = params.get("role");
  const nextRaw = params.get("next");
  return useMemo(() => {
    const flowParam = parseFlow(flowRaw);
    return { flowParam, flow: flowParam ?? "signup", role: parseRole(roleRaw), next: sanitizeNext(nextRaw) };
  }, [flowRaw, roleRaw, nextRaw]);
}
