/**
 * Playwright global setup (D5): reset the Firebase emulators and run the dev seed once before
 * any spec. Refuses to run unless FIRESTORE_EMULATOR_HOST is set (use `npm run test:e2e`,
 * which wraps Playwright in `firebase emulators:exec`). Set E2E_SKIP_SEED=1 to keep the
 * current emulator data (e.g. when re-running one spec against an already seeded emulator).
 */
import { execSync } from "node:child_process";
import path from "node:path";

export default async function globalSetup(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("E2E needs the Firebase emulators. Run `npm run test:e2e` (it starts them), or `npm run emulators` and set FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST.");
  }
  if (process.env.E2E_SKIP_SEED === "1") return;
  const started = Date.now();
  execSync("npm run seed -- --reset", { cwd: path.resolve(__dirname, "../.."), stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, NODE_ENV: "development" } });
  console.log(`[e2e] emulators reset and seeded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
