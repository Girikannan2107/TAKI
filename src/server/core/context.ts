import "server-only";
/**
 * THE canonical SessionContext (P2 §3.5) and the context passed to every core command.
 *
 * D1's `src/server/auth/guards.ts` builds it (`requireSession`, `getServerSession`) and re-exports
 * this type; nothing else declares its own. Unauthenticated / wrong-role callers get a
 * `DomainError("unauthenticated" | "forbidden")` (401 / 403), which the handler wrapper maps.
 *
 * System actions (sweep, webhooks, seed) use `SYSTEM_ACTOR` and a `SystemCtx`.
 */
import type { Actor, Id, IsoDateTime, Mobile, Role } from "@/lib/domain/model";

/** The authenticated caller, as every handler / core function sees it. Never trusted from the client. */
export interface SessionContext {
  userId: Id;
  role: Role;
  /** customers/{userId} · drivers/{userId} · agencies/{agencyId} · admin → userId. */
  profileId: Id;
  /** Set for agency users, null otherwise. */
  agencyId: Id | null;
  /** `sessions/{sha256(sid)}` document id. */
  sessionId: string;
  /** Display name (`users.displayName`). */
  name: string;
  phone: Mobile;
  /** Current session expiry. */
  expiresAt: IsoDateTime;
  /** When the session was created (renewal is capped relative to this). */
  createdAt: IsoDateTime;
}

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
