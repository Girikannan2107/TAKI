"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import type { AuthFlow } from "@/lib/store";
import { safeRedirect } from "@/lib/utils/safe-redirect";

export function parseFlow(value: string | null | undefined): AuthFlow | null {
  return value === "signup" || value === "login" || value === "reset" ? value : null;
}

export function parseRole(value: string | null | undefined): Role | undefined {
  return value === "customer" || value === "driver" ? value : undefined;
}

/**
 * Keep `?next` only if it could be a valid return path for some role. The final redirect still
 * re-checks it against the signed-in role with `safeRedirect(next, role)`.
 */
export function sanitizeNext(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return safeRedirect(value, "customer") || safeRedirect(value, "driver") ? value : undefined;
}

export interface AuthQuery {
  /** Flow from `?flow` (null when absent/invalid). */
  flowParam: AuthFlow | null;
  /** `?flow` with the route-contract default ("signup"). */
  flow: AuthFlow;
  role: Role | undefined;
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
