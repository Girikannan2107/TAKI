import "server-only";
import type { Role } from "@/lib/domain/model";
import { C, getDocStore, type TxContext } from "@/server/db";
import type { SessionDoc, UserDoc } from "@/server/db/schema";
import { auditHash, randomToken, sha256 } from "./crypto";
import type { SessionContext } from "@/server/core/context";
import {
  SESSION_MAX_AGE_DAYS,
  SESSION_TTL_DAYS,
  serializeCookie,
  sessionCookieAttributes,
  signSessionCookie,
  verifySessionCookie,
} from "./session-cookie";

/*
 * Server sessions (P2 §3.5): opaque sid in a signed httpOnly cookie, `sessions/{sha256(sid)}` record
 * (revocable), user status re-checked on every request.
 */

const DAY_MS = 86_400_000;
const RENEW_WHEN_LEFT_MS = DAY_MS;

export interface IssuedSession {
  sessionId: string;
  /** Set-Cookie header value. */
  setCookie: string;
  expiresAt: string;
}

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

function profileIdFor(user: UserDoc): string {
  return user.role === "agency" && user.agencyId ? user.agencyId : user.id;
}

export function toSessionContext(user: UserDoc, session: SessionDoc): SessionContext {
  return {
    userId: user.id,
    role: user.role,
    sessionId: session.id,
    name: user.displayName,
    phone: user.phone,
    profileId: profileIdFor(user),
    agencyId: user.agencyId ?? null,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  };
}

function buildSessionDoc(id: string, user: Pick<UserDoc, "id" | "role">, now: Date, meta: SessionMeta): SessionDoc {
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * DAY_MS);
  return {
    id,
    userId: user.id,
    role: user.role,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    expiresAtTs: expires,
    lastSeenAt: now.toISOString(),
    revokedAt: null,
    userAgentHash: auditHash(meta.userAgent),
    ipHash: auditHash(meta.ip),
  };
}

async function cookieFor(sid: string, role: Role, expiresAt: Date, now: Date): Promise<string> {
  const value = await signSessionCookie({ sid, r: role, exp: Math.floor(expiresAt.getTime() / 1000) });
  return serializeCookie(sessionCookieAttributes(value, (expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Fresh session (new sid on every login/signup — no fixation). Pass `tx` to create it inside the signup /
 * login transaction; otherwise it is written on its own.
 */
export async function issueSession(user: Pick<UserDoc, "id" | "role">, now: Date, meta: SessionMeta = {}, tx?: TxContext): Promise<IssuedSession> {
  const sid = randomToken(32);
  const id = sha256(sid);
  const doc = buildSessionDoc(id, user, now, meta);
  if (tx) tx.create(C.sessions, id, doc);
  else await getDocStore().runTransaction(async (t) => t.create(C.sessions, id, doc));
  return { sessionId: id, setCookie: await cookieFor(sid, user.role, doc.expiresAtTs, now), expiresAt: doc.expiresAt };
}

/** Cookie value → SessionContext, or null when absent / invalid / revoked / expired / user disabled or role changed. */
export async function resolveSession(cookieValue: string | null, now: Date): Promise<SessionContext | null> {
  const payload = await verifySessionCookie(cookieValue, now.getTime());
  if (!payload) return null;
  const store = getDocStore();
  const session = await store.get<SessionDoc>(C.sessions, sha256(payload.sid));
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) return null;
  if (session.role !== payload.r) return null;
  const user = await store.get<UserDoc>(C.users, session.userId);
  if (!user || user.status !== "active" || user.role !== session.role) return null;
  return toSessionContext(user, session);
}

/** Revoke one session (logout). Idempotent. */
export async function revokeSession(sessionId: string, now: Date): Promise<void> {
  await getDocStore().runTransaction(async (tx) => {
    const s = await tx.get<SessionDoc>(C.sessions, sessionId);
    if (!s || s.revokedAt) return;
    tx.update(C.sessions, sessionId, { revokedAt: now.toISOString() });
  });
}

/**
 * Revoke every active session of a user (password reset), or every OTHER one (password / phone change).
 * Runs inside `tx` when given (reads first — call before any write in that transaction).
 */
export async function revokeUserSessions(
  userId: string,
  now: Date,
  opts: { exceptSessionId?: string; tx?: TxContext } = {},
): Promise<number> {
  const run = async (tx: TxContext) => {
    const sessions = await tx.query<SessionDoc>(C.sessions, { where: [["userId", "==", userId]] });
    return sessions.filter((s) => !s.revokedAt && s.id !== opts.exceptSessionId && Date.parse(s.expiresAt) > now.getTime());
  };
  if (opts.tx) {
    const live = await run(opts.tx);
    for (const s of live) opts.tx.update(C.sessions, s.id, { revokedAt: now.toISOString() });
    return live.length;
  }
  return getDocStore().runTransaction(async (tx) => {
    const live = await run(tx);
    for (const s of live) tx.update(C.sessions, s.id, { revokedAt: now.toISOString() });
    return live.length;
  });
}

/**
 * Sliding renewal: when under 24 h remain, extend to +7 days (capped at 30 days from creation) and
 * re-issue the cookie on `res`. No-op otherwise or if the cookie no longer matches the session.
 */
export async function renewSession(cookieValue: string | null, res: Response, ctx: SessionContext, now: Date): Promise<void> {
  const left = Date.parse(ctx.expiresAt) - now.getTime();
  if (left > RENEW_WHEN_LEFT_MS) return;
  const payload = await verifySessionCookie(cookieValue, now.getTime());
  if (!payload || sha256(payload.sid) !== ctx.sessionId) return;
  const cap = Date.parse(ctx.createdAt) + SESSION_MAX_AGE_DAYS * DAY_MS;
  const target = Math.min(now.getTime() + SESSION_TTL_DAYS * DAY_MS, cap);
  if (target <= Date.parse(ctx.expiresAt)) return;
  const expires = new Date(target);
  await getDocStore().runTransaction(async (tx) => {
    const s = await tx.get<SessionDoc>(C.sessions, ctx.sessionId);
    if (!s || s.revokedAt) return;
    tx.update(C.sessions, ctx.sessionId, { expiresAt: expires.toISOString(), expiresAtTs: expires, lastSeenAt: now.toISOString() });
  });
  try {
    res.headers.append("set-cookie", await cookieFor(payload.sid, ctx.role, expires, now));
  } catch {
    // Immutable headers (e.g. redirect responses) — renewal happens on the next mutating request.
  }
}
