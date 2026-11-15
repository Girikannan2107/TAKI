import "server-only";
import { isProduction } from "@/server/env";
import { devSmsProvider } from "./dev";
import { createMsg91Provider } from "./msg91";
import type { SmsProvider } from "./types";

export type { OtpPurpose, SmsProvider } from "./types";

let override: SmsProvider | null = null;

/** Tests only: replace the provider. */
export function setSmsProviderForTests(p: SmsProvider | null): void {
  if (process.env.VITEST !== "true") throw new Error("setSmsProviderForTests is only available under vitest");
  override = p;
}

/**
 * SMS_PROVIDER=dev (default outside production) | msg91. `dev` in production is refused.
 * Uses isProduction(), which treats the emulator-only TAKI_E2E build as non-production (env.ts guards that).
 */
export function getSmsProvider(): SmsProvider {
  if (override) return override;
  const name = process.env.SMS_PROVIDER ?? (isProduction() ? "msg91" : "dev");
  if (name === "dev") {
    if (isProduction()) throw new Error("SMS_PROVIDER=dev is not allowed in production.");
    return devSmsProvider;
  }
  if (name === "msg91") return createMsg91Provider();
  throw new Error(`Unknown SMS_PROVIDER "${name}"`);
}

/** True when OTP codes may be shown on screen ("Dev OTP"). */
export function isDevSms(): boolean {
  return getSmsProvider().name === "dev";
}
