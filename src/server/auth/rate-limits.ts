import "server-only";
import { getDocStore } from "@/server/db";
import { hitRateLimit, RATE_LIMITS, type RateLimitRule } from "@/server/http/rate-limit";

export { clientIp } from "@/server/http/origin";

/** Auth rate-limit buckets (P2 §3.9) on D5's fixed-window limiter. */
export interface LimitRule {
  bucket: string;
  rule: RateLimitRule;
}

export const AUTH_LIMITS = {
  otpSendPhoneHour: (e164: string): LimitRule => ({ bucket: `otp:send:phone:${e164}`, rule: RATE_LIMITS.otpSendPhoneHour }),
  otpSendPhoneDay: (e164: string): LimitRule => ({ bucket: `otp:send:phone:${e164}`, rule: RATE_LIMITS.otpSendPhoneDay }),
  otpSendIp: (ip: string): LimitRule => ({ bucket: `otp:send:ip:${ip}`, rule: RATE_LIMITS.otpSendIpHour }),
  otpVerifyIp: (ip: string): LimitRule => ({ bucket: `otp:verify:ip:${ip}`, rule: RATE_LIMITS.otpVerifyIpHour }),
  loginIp: (ip: string): LimitRule => ({ bucket: `login:ip:${ip}`, rule: RATE_LIMITS.login }),
  uploadUser: (userId: string): LimitRule => ({ bucket: `upload:user:${userId}`, rule: RATE_LIMITS.upload }),
} as const;

/** Counts one hit per rule, in order; throws 429 `rate_limited` (details.retryAfterSeconds) on the first breach. */
export async function hitRateLimits(rules: readonly LimitRule[], now: Date): Promise<void> {
  const store = getDocStore();
  for (const r of rules) await hitRateLimit(store, r.bucket, r.rule, now);
}
