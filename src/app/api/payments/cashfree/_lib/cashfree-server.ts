/**
 * Server-only helpers for the Cashfree payment stubs (PREPARED, NOT ACTIVE).
 *
 * Secrets are read from `process.env` inside request handlers only — never at
 * module scope, never with a NEXT_PUBLIC_ prefix, and never logged. This folder
 * is private (`_lib`), so it is not routable.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  env: "sandbox" | "production";
}

/** Reads the gateway config for this request, or null when payments are not configured. */
export function readCashfreeConfig(): CashfreeConfig | null {
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secretKey = process.env.CASHFREE_SECRET_KEY?.trim();
  const rawEnv = process.env.CASHFREE_ENV?.trim();
  if (!appId || !secretKey || (rawEnv !== "sandbox" && rawEnv !== "production")) return null;
  return { appId, secretKey, env: rawEnv };
}

const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** 501 — the deployment has no Cashfree credentials. */
export function notConfigured(): Response {
  return jsonResponse({ error: "payments_not_configured" }, 501);
}

/** 501 — credentials exist but the live integration has not been built yet. */
export function notImplemented(): Response {
  return jsonResponse({ error: "not_implemented" }, 501);
}

/**
 * Verifies a Cashfree webhook signature.
 *
 * Cashfree signs `timestamp + rawBody` with HMAC-SHA256 using the client secret and
 * sends the base64 digest in `x-webhook-signature` (timestamp in `x-webhook-timestamp`).
 * The raw body must be the exact bytes received — never re-serialised JSON.
 * Comparison is constant-time (`crypto.timingSafeEqual`).
 */
export function verifyWebhookSignature(input: {
  timestamp: string | null | undefined;
  rawBody: string;
  signature: string | null | undefined;
  secret: string;
}): boolean {
  const { timestamp, rawBody, signature, secret } = input;
  if (!timestamp || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(timestamp + rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature.trim(), "base64");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Replay window for webhook timestamps. Accepts seconds or milliseconds since the epoch.
 * Default tolerance: 5 minutes either side of `now`.
 */
export function isFreshTimestamp(timestamp: string | null | undefined, now: number = Date.now(), toleranceMs = 5 * 60_000): boolean {
  if (!timestamp || !/^\d{10,13}$/.test(timestamp.trim())) return false;
  const n = Number(timestamp.trim());
  const ms = n < 1e12 ? n * 1000 : n;
  return Math.abs(now - ms) <= toleranceMs;
}

/** Booking ids are `TAKI` + 6 digits. */
export function isBookingId(v: unknown): v is string {
  return typeof v === "string" && /^TAKI\d{6}$/.test(v);
}

/** Idempotency keys from `newIdempotencyKey()` — bounded, URL-safe. */
export function isIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(v);
}
