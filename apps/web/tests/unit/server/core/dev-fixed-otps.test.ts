import { afterEach, describe, expect, it } from "vitest";
import { checkStartupEnv, DEV_OTPS, devFixedOtps, resetEnvCache } from "@/server/env";

/** DEV_FIXED_OTPS: predictable codes for local testing only — never in production. */
describe("DEV_FIXED_OTPS", () => {
  const keys = ["DEV_FIXED_OTPS", "NODE_ENV", "TAKI_E2E", "FIRESTORE_EMULATOR_HOST"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const env = process.env as Record<string, string | undefined>;
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
    resetEnvCache();
  });

  it("is off unless the flag is set", () => {
    delete env.DEV_FIXED_OTPS;
    resetEnvCache();
    expect(devFixedOtps()).toBeNull();
  });

  it("returns the documented codes outside production", () => {
    env.DEV_FIXED_OTPS = "true";
    env.NODE_ENV = "development";
    resetEnvCache();
    expect(devFixedOtps()).toEqual({ phone: "123456", pickup: "111111", delivery: "222222" });
    expect(DEV_OTPS.pickup).not.toBe(DEV_OTPS.delivery);
  });

  it("is ignored in production and refuses to start a production server", () => {
    env.DEV_FIXED_OTPS = "true";
    env.NODE_ENV = "production";
    delete env.TAKI_E2E;
    resetEnvCache();
    expect(devFixedOtps()).toBeNull();
    expect(() => checkStartupEnv()).toThrow(/DEV_FIXED_OTPS is set in production/);
  });
});
