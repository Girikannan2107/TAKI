/**
 * Runs once when a Next.js server instance starts (D5). Fails fast on unsafe env combinations,
 * e.g. TAKI_E2E without the Firebase emulator (see src/server/env.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkStartupEnv } = await import("./server/env");
  checkStartupEnv();
}
