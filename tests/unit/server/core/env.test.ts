import { afterEach, describe, expect, it } from "vitest";
import { checkStartupEnv, env, resetEnvCache } from "@/server/env";

describe("server env guard", () => {
  const saved = { e2e: process.env.TAKI_E2E, host: process.env.FIRESTORE_EMULATOR_HOST };
  afterEach(() => {
    if (saved.e2e === undefined) delete process.env.TAKI_E2E;
    else process.env.TAKI_E2E = saved.e2e;
    if (saved.host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = saved.host;
    resetEnvCache();
  });

  it("refuses TAKI_E2E without the Firestore emulator", () => {
    process.env.TAKI_E2E = "1";
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(() => checkStartupEnv()).toThrow(/only allowed against the Firebase emulators/);
  });

  it("allows TAKI_E2E with the emulator", () => {
    process.env.TAKI_E2E = "1";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    expect(() => checkStartupEnv()).not.toThrow();
    expect(env().TAKI_E2E).toBe(true);
  });
});
