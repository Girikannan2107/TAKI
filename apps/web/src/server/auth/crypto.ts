import "server-only";
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "./session-cookie";

/** 32 random bytes, base64url (43 chars). Session ids and OTP proof tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** 6-digit numeric code, zero-padded, from a CSPRNG. */
export function randomOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const derived = new Map<string, Buffer>();

/** Sub-key derived from SESSION_SECRET with HKDF-SHA256 (e.g. info "taki-otp-v1"). */
export function deriveKey(info: string): Buffer {
  const secret = getSessionSecret();
  const cacheKey = `${info}\u0000${secret}`;
  let k = derived.get(cacheKey);
  if (!k) {
    k = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(info, "utf8"), 32));
    derived.set(cacheKey, k);
  }
  return k;
}

export function hmac(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

/** Constant-time string comparison (equal-length base64url digests). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Non-reversible hash for audit fields (user agent, IP) — never stored raw. */
export function auditHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return hmac(deriveKey("taki-audit-v1"), value).slice(0, 22);
}
