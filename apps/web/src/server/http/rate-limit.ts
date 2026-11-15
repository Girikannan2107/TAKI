import "server-only";
/**
 * Fixed-window rate limits (P2 §3.9) stored in `rateLimits/{sha256(bucket)}` and
 * incremented in a transaction. A breach throws DomainError("rate_limited") with
 * `details.retryAfterSeconds` (the handler sets the Retry-After header).
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { C } from "../db/collections";
import type { DocStore } from "../db/docstore";
import type { RateLimitDoc } from "../db/schema";
import { sha256Hex } from "./crypto";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  otpSendPhoneHour: { limit: 5, windowSeconds: 3600 },
  otpSendPhoneDay: { limit: 10, windowSeconds: 86_400 },
  otpSendIpHour: { limit: 20, windowSeconds: 3600 },
  otpVerifyIpHour: { limit: 60, windowSeconds: 3600 },
  login: { limit: 30, windowSeconds: 900 },
  bookingCreate: { limit: 30, windowSeconds: 3600 },
  paymentCreate: { limit: 20, windowSeconds: 3600 },
  upload: { limit: 60, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Count one hit on `bucket` (e.g. `booking:create:user:usr_…`). Throws when over the limit.
 * Bucket names include the window so one bucket string can carry several rules.
 */
export async function hitRateLimit(store: DocStore, bucket: string, rule: RateLimitRule, now: Date): Promise<{ remaining: number }> {
  const key = `${bucket}|${rule.windowSeconds}`;
  const id = sha256Hex(key);
  const windowMs = rule.windowSeconds * 1000;
  const nowMs = now.getTime();
  return store.runTransaction(
    async (tx) => {
      const cur = await tx.get<RateLimitDoc>(C.rateLimits, id);
      const fresh = !cur || Date.parse(cur.expiresAt) <= nowMs;
      const windowStart = fresh ? now : new Date(cur!.windowStart);
      const count = fresh ? 1 : cur!.count + 1;
      const expires = new Date(windowStart.getTime() + windowMs);
      if (count > rule.limit) {
        throw new DomainError("rate_limited", undefined, { details: { retryAfterSeconds: Math.ceil((expires.getTime() - nowMs) / 1000) } });
      }
      const doc: RateLimitDoc = {
        id,
        bucket: key,
        count,
        windowStart: windowStart.toISOString(),
        expiresAt: expires.toISOString(),
        expiresAtTs: expires,
      };
      tx.set(C.rateLimits, id, doc);
      return { remaining: rule.limit - count };
    },
    { maxAttempts: 10 },
  );
}
