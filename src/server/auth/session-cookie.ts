/**
 * Signed session cookie (P2 §3.5). Web Crypto only — no `server-only`, no Node APIs — so `src/proxy.ts`
 * can verify it cheaply (role + expiry) without a database call. The authoritative check (revocation,
 * user status) is `requireSession()` in every handler.
 *
 * Value: base64url(JSON{ sid, r, exp }) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payload))
 */
import type { Role } from "@/lib/domain/model";

export const SESSION_COOKIE_DEV = "taki_session";
export const SESSION_COOKIE_PROD = "__Host-taki_session";
export const SESSION_TTL_DAYS = 7;
/** Sliding renewal never extends a session beyond this many days after it was created. */
export const SESSION_MAX_AGE_DAYS = 30;

const DEV_FALLBACK_SECRET = "taki-dev-only-session-secret-do-not-use-in-production-0001";
const ROLES: readonly Role[] = ["customer", "agency", "driver", "admin"];

export interface SessionCookiePayload {
  /** Raw session id (32 random bytes, base64url). Only its sha256 is stored server-side. */
  sid: string;
  r: Role;
  /** Expiry, epoch seconds. */
  exp: number;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Cookie name: `__Host-` prefix needs Secure, so plain name over http in dev/test. */
export function sessionCookieName(): string {
  return isProduction() ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV;
}

let warned = false;
/** SESSION_SECRET (≥ 32 chars). Dev/test fall back to a fixed, clearly-insecure constant; production throws. */
export function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isProduction()) throw new Error("SESSION_SECRET must be set (at least 32 characters) in production.");
  if (!warned && process.env.VITEST !== "true") {
    warned = true;
    console.warn("[auth] SESSION_SECRET is not set; using the insecure development fallback.");
  }
  return DEV_FALLBACK_SECRET;
}

// ── base64url helpers (no Buffer: must run in any runtime) ───────────────────
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, k);
  }
  return k;
}

/** Signs a payload into a cookie value. */
export async function signSessionCookie(payload: SessionCookiePayload, secret = getSessionSecret()): Promise<string> {
  const body = bytesToBase64Url(enc.encode(JSON.stringify({ sid: payload.sid, r: payload.r, exp: payload.exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${bytesToBase64Url(sig)}`;
}

/**
 * Verifies the HMAC (constant-time via subtle.verify) and the expiry. Returns null for anything invalid.
 * `nowMs` defaults to Date.now().
 */
export async function verifySessionCookie(
  value: string | null | undefined,
  nowMs: number = Date.now(),
  secret = getSessionSecret(),
): Promise<SessionCookiePayload | null> {
  if (!value || value.length > 1024) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
  const body = value.slice(0, dot);
  const sig = base64UrlToBytes(value.slice(dot + 1));
  if (!sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig as Uint8Array<ArrayBuffer>, enc.encode(body));
  if (!ok) return null;
  const raw = base64UrlToBytes(body);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { sid, r, exp } = parsed as Record<string, unknown>;
  if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sid)) return null;
  if (typeof r !== "string" || !(ROLES as readonly string[]).includes(r)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
  return { sid, r: r as Role, exp };
}

/** Reads the session cookie value from a Cookie header. */
export function readCookie(cookieHeader: string | null | undefined, name = sessionCookieName()): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/** Attributes for setting the session cookie (use with NextResponse.cookies.set or serializeCookie). */
export function sessionCookieAttributes(value: string, maxAgeSeconds: number): CookieAttributes {
  return {
    name: sessionCookieName(),
    value,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Set-Cookie header value. `maxAge` 0 clears the cookie. */
export function serializeCookie(a: CookieAttributes): string {
  const parts = [`${a.name}=${encodeURIComponent(a.value)}`, `Path=${a.path}`, `Max-Age=${a.maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (a.secure) parts.push("Secure");
  if (a.maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  return serializeCookie(sessionCookieAttributes("", 0));
}
