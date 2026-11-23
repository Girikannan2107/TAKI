import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * TAKI v3 browser e2e (T1): Next.js (apps/web) → /api/v1 rewrite → FastAPI (backend/) → Firebase emulators.
 *
 * Prerequisite: Firebase emulators running (auth 9099, firestore 8080, storage 9199, project demo-taki),
 * e.g. `node scripts/dev.mjs --no-api --no-web` or `npm run emulators`. The database may start empty:
 * every spec builds its own fixtures through the API + emulator OTPs (tests/support/e2e-api.ts) and the
 * global setup only bootstraps an admin (backend/scripts/create_admin.py). Nothing is wiped.
 *
 *   npx playwright test                      # desktop (1440×900) + mobile (390×844)
 *   npx playwright test --project=desktop    # one viewport
 *
 * Servers: FastAPI on E2E_API_PORT (8010) and `next dev` on E2E_PORT (3010) are started here, or reused
 * when already listening. Ports differ from the dev defaults (8000/3000) so a dev stack can keep running.
 */
const PORT = Number(process.env.E2E_PORT ?? 3010);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8010);
const ORIGIN = `http://localhost:${PORT}`;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const REPO = path.resolve(__dirname, "../..");
const PY = path.join(REPO, "backend", process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");

process.env.E2E_API_ORIGIN ??= API_ORIGIN;

const emulators = {
  FIREBASE_PROJECT_ID: "demo-taki",
  FIREBASE_STORAGE_BUCKET: "demo-taki.appspot.com",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  globalSetup: "./tests/support/e2e-global-setup.ts",
  fullyParallel: false,
  retries: 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
  },
  webServer: [
    {
      // --timeout-keep-alive above Node's 5 s agent idle timeout: with both at 5 s the Next dev proxy
      // reuses a socket uvicorn is closing (ECONNRESET / "socket hang up" → 500 in the browser).
      command: `"${PY}" -m uvicorn app.main:app --app-dir backend --port ${API_PORT} --timeout-keep-alive 75`,
      cwd: REPO,
      url: `${API_ORIGIN}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...emulators,
        APP_ENV: "development",
        PAYMENT_PROVIDER: "dev",
        APP_ORIGIN: ORIGIN,
        // Signed file URLs go through the Next rewrite (same origin as the page).
        PUBLIC_API_BASE_URL: ORIGIN,
        CORS_ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:${PORT}`,
        LOG_JSON: "false",
        // One machine runs every signup/login of the suite from 127.0.0.1; T3 owns the rate-limit tests.
        RATE_LIMITS_ENABLED: "false",
      },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx next dev -p ${PORT}`,
      url: ORIGIN,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { API_PROXY_TARGET: API_ORIGIN, NEXT_PUBLIC_ENABLE_DEV_GATEWAY: "true" },
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
