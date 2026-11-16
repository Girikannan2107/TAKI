/**
 * Playwright global setup (T1, v3): no reset and no seed — the database may be empty and is shared with other
 * test runs, so nothing is wiped. Checks that the Firebase Auth emulator and the API are reachable and
 * bootstraps the e2e admin (idempotent `create_admin.py --force` on a fixed T1 phone).
 */
import { API, AUTH_EMU, ensureAdmin } from "./e2e-api";

export default async function globalSetup(): Promise<void> {
  const auth = await fetch(`${AUTH_EMU}/emulator/v1/projects/demo-taki/config`).catch(() => null);
  if (!auth?.ok) throw new Error(`Firebase Auth emulator not reachable at ${AUTH_EMU}. Start the emulators first (node scripts/dev.mjs --no-api --no-web).`);
  const health = await fetch(`${API}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`FastAPI not reachable at ${API}`);
  ensureAdmin();
}
