/**
 * Runs once when a Next.js server instance starts (D5). Fails fast on unsafe env combinations,
 * e.g. TAKI_E2E without the Firebase emulator (see src/server/env.ts). In development it also
 * warns, without blocking startup, when the Firestore emulator isn't running yet.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkStartupEnv, isProduction } = await import("./server/env");
  checkStartupEnv();
  if (isProduction() || !process.env.FIRESTORE_EMULATOR_HOST) return;
  const { ensureDatabaseReachable } = await import("./server/db/emulator-probe");
  try {
    await ensureDatabaseReachable();
  } catch {
    console.warn(
      `\n[taki] ⚠ Firestore emulator not reachable at ${process.env.FIRESTORE_EMULATOR_HOST}. ` +
        `API calls (login, search…) will return 503 until you run "npm run emulators" ` +
        `(then "npm run seed -- --reset" for demo data).\n`,
    );
  }
}
