import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a production build on the Firebase emulators (D5).
 *
 *   npm run test:e2e:build   # next build (once per code change)
 *   npm run test:e2e         # emulators (firestore + storage) → reset + seed → next start :3100 → Playwright
 *
 * `npm run test:e2e` wraps Playwright in `firebase emulators:exec`, which sets
 * FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST. The global setup reseeds the
 * emulator (`npm run seed -- --reset`) before any spec runs. `next start` does not read
 * .env.development, so the server env is passed explicitly below; secrets come from
 * .env.local (SESSION_SECRET, PII_HASH_KEY, CRON_SECRET).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const ORIGIN = `http://localhost:${PORT}`;

const envLocal = path.resolve(__dirname, ".env.local");
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

function serverEnv(): Record<string, string> {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const storage = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199";
  const env: Record<string, string> = {
    TAKI_E2E: "1",
    APP_ORIGIN: ORIGIN,
    FIRESTORE_EMULATOR_HOST: firestore,
    FIREBASE_STORAGE_EMULATOR_HOST: storage,
    FIREBASE_PROJECT_ID: "demo-taki",
    FIREBASE_STORAGE_BUCKET: "demo-taki.appspot.com",
    SMS_PROVIDER: "dev",
    PAYMENT_PROVIDER: "dev",
    REQUIRE_DELIVERY_PROOF: "true",
  };
  for (const k of ["SESSION_SECRET", "PII_HASH_KEY", "CRON_SECRET"]) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  globalSetup: "./tests/support/e2e-global-setup.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${ORIGIN}/api/health`,
    env: serverEnv(),
    // Never reuse a server that might point at something other than the emulator.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "small", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
});
