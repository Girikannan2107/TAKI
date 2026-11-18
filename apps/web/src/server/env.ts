import "server-only";
/**
 * Server environment (P2 §13.1). Read lazily (never at module scope in a way that breaks
 * the build) and validated with zod. Secrets are never logged.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";

const Bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),
  APP_ORIGIN: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  PII_HASH_KEY: z.string().optional(),
  SMS_PROVIDER: z.enum(["dev", "msg91"]).optional().default("dev"),
  SMS_NOTIFICATIONS: Bool,
  PAYMENT_PROVIDER: z.enum(["dev", "cashfree"]).optional().default("dev"),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  CASHFREE_ENV: z.enum(["sandbox", "production"]).optional(),
  CASHFREE_API_VERSION: z.string().optional().default("2025-01-01"),
  CRON_SECRET: z.string().optional(),
  TRUST_PROXY_HEADERS: Bool,
  DEV_AUTO_VERIFY_AGENCIES: Bool,
  DEV_FIXED_OTPS: Bool,
  REQUIRE_DELIVERY_PROOF: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  TAKI_E2E: Bool,
  VITEST: z.string().optional(),
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | null = null;

/** Parsed env. Cached; tests may call `resetEnvCache()` after mutating process.env. */
export function env(): ServerEnv {
  if (!cached) {
    const parsed = EnvSchema.parse(process.env);
    assertE2EIsEmulatorOnly(parsed);
    cached = parsed;
  }
  return cached;
}

/**
 * TAKI_E2E relaxes production checks (dev payments/SMS, emulator under `next start`) for the
 * Playwright run. It is refused unless FIRESTORE_EMULATOR_HOST is set, so it can never take
 * effect on a real deployment.
 */
function assertE2EIsEmulatorOnly(e: Pick<ServerEnv, "TAKI_E2E" | "FIRESTORE_EMULATOR_HOST">): void {
  if (e.TAKI_E2E && !e.FIRESTORE_EMULATOR_HOST?.trim()) {
    throw new Error("TAKI_E2E is set but FIRESTORE_EMULATOR_HOST is not: TAKI_E2E is only allowed against the Firebase emulators.");
  }
}

/** Server startup check (src/instrumentation.ts): fail fast on unsafe env combinations. */
export function checkStartupEnv(): void {
  resetEnvCache();
  env();
  if (env().DEV_FIXED_OTPS && isProduction()) {
    throw new Error("DEV_FIXED_OTPS is set in production: fixed OTPs are for local testing only. Remove it.");
  }
}

export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production" && !env().TAKI_E2E;
}

export function isTestRun(): boolean {
  return process.env.VITEST === "true";
}

export function usingFirestoreEmulator(): boolean {
  return Boolean(env().FIRESTORE_EMULATOR_HOST);
}

/** Canonical origin for CSRF checks and gateway return URLs. */
export function appOrigin(): string {
  const o = env().APP_ORIGIN?.trim();
  if (o) return o.replace(/\/+$/, "");
  if (isProduction()) throw new Error("APP_ORIGIN must be set in production");
  return "http://localhost:3000";
}

let devSessionSecret: string | null = null;

/** Parent secret for session HMAC, OTP and dev-payment keys (HKDF). */
export function sessionSecret(): string {
  const s = env().SESSION_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (isProduction()) throw new Error("SESSION_SECRET (>= 32 chars) must be set in production");
  if (!devSessionSecret) {
    devSessionSecret = randomBytes(32).toString("base64");
    if (!isTestRun()) console.warn("[taki] SESSION_SECRET is not set; generated a per-process dev secret (sessions reset on restart).");
  }
  return devSessionSecret;
}

const DEV_PII_KEY = "taki-dev-only-pii-hash-key-not-for-production";

/** Key for document-number HMACs. Never rotate in production. */
export function piiHashKey(): string {
  const k = env().PII_HASH_KEY?.trim();
  if (k && k.length >= 32) return k;
  if (isProduction()) throw new Error("PII_HASH_KEY (>= 32 chars) must be set in production");
  return DEV_PII_KEY;
}

export function paymentProvider(): "dev" | "cashfree" {
  const p = env().PAYMENT_PROVIDER;
  if (p === "dev" && isProduction()) throw new Error("PAYMENT_PROVIDER=dev is not allowed in production");
  return p;
}

export function requireDeliveryProof(): boolean {
  return env().REQUIRE_DELIVERY_PROOF;
}

/** Fixed codes used when DEV_FIXED_OTPS=true (local testing only; see docs/DEMO_LOGINS.md). */
export const DEV_OTPS = { phone: "123456", pickup: "111111", delivery: "222222" } as const;

/**
 * Local-testing convenience: predictable OTPs (phone sign-up/recovery/phone change, booking
 * pickup and delivery). Never in production — returns null there, and checkStartupEnv()
 * refuses to boot a production server with the flag set.
 */
export function devFixedOtps(): typeof DEV_OTPS | null {
  return env().DEV_FIXED_OTPS && !isProduction() ? DEV_OTPS : null;
}

/** Non-production convenience: verify agencies at signup. Ignored in production. */
export function devAutoVerifyAgencies(): boolean {
  return !isProduction() && env().DEV_AUTO_VERIFY_AGENCIES;
}
