import "server-only";
/**
 * Context passed to every core command. `actor` is the authenticated caller (D1's
 * SessionContext from requireSession). System actions (sweep, webhooks, seed) use
 * `systemCtx(now)`.
 */
import type { Actor } from "@/lib/domain/model";
import type { SessionContext } from "../auth/guards";

export type { SessionContext };

export interface Ctx {
  now: Date;
  actor: SessionContext;
}

/** Context for system-initiated work (no user). */
export interface SystemCtx {
  now: Date;
}

export function actorOf(s: SessionContext | null): Actor {
  return s ? { role: s.role, userId: s.userId } : { role: "system", userId: null };
}

export const SYSTEM_ACTOR: Actor = { role: "system", userId: null };

export function iso(d: Date): string {
  return d.toISOString();
}
