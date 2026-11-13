import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { DomainError } from "@/lib/api/contracts/errors";
import type { Role } from "@/lib/domain/model";
import { now } from "@/server/clock";
import type { SessionContext } from "@/server/core/context";
import { readCookie } from "./session-cookie";
import { renewSession, resolveSession } from "./sessions";

/**
 * The authenticated caller (P2 §3.5). The canonical type lives in D5's `@/server/core/context`; it is
 * built here from the signed cookie + `sessions/{hash}` + `users/{id}` (never trusted from the client).
 */
export type { SessionContext };

/** "any" = any signed-in role. */
export type RoleRequirement = "any" | Role | readonly Role[];

export function roleAllowed(role: Role, required: RoleRequirement): boolean {
  if (required === "any") return true;
  if (typeof required === "string") return role === required;
  return required.includes(role);
}

const perRequest = new WeakMap<Request, Promise<SessionContext | null>>();

/** Resolves the session for a request (memoised per Request object). Null when absent, invalid, revoked or expired. */
export function getSession(req: Request): Promise<SessionContext | null> {
  let p = perRequest.get(req);
  if (!p) {
    p = resolveSession(readCookie(req.headers.get("cookie")), now());
    perRequest.set(req, p);
  }
  return p;
}

function enforce(ctx: SessionContext | null, role: RoleRequirement): SessionContext {
  if (!ctx) throw new DomainError("unauthenticated");
  if (!roleAllowed(ctx.role, role)) throw new DomainError("forbidden");
  return ctx;
}

/**
 * Authoritative check for route handlers: HMAC → session record (not revoked / expired) →
 * user active → role. Throws DomainError `unauthenticated` (401), `forbidden` (403) or `account_disabled` (403).
 */
export async function requireSession(req: Request, role: RoleRequirement = "any"): Promise<SessionContext> {
  return enforce(await getSession(req), role);
}

const serverSession = cache(async (): Promise<SessionContext | null> => {
  const h = await headers();
  return resolveSession(readCookie(h.get("cookie")), now());
});

/** Server Components / layouts: the session for the current request (React cache()). Null when signed out. */
export function getServerSession(): Promise<SessionContext | null> {
  return serverSession();
}

/** Server Components / layouts: like requireSession, reading next/headers. */
export async function requireServerSession(role: RoleRequirement = "any"): Promise<SessionContext> {
  return enforce(await serverSession(), role);
}

/**
 * Sliding renewal (P2 §3.5): call from mutating handlers after success. When less than 24 h remain,
 * re-issues the cookie on `res` and extends `sessions.expiresAt` (capped at 30 days from creation).
 */
export async function renewSessionIfNeeded(req: Request, res: Response, ctx: SessionContext, now: Date): Promise<void> {
  await renewSession(readCookie(req.headers.get("cookie")), res, ctx, now);
}
