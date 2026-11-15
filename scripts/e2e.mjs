/**
 * `npm run test:e2e [-- <playwright args>]` — one-command E2E (D5):
 * starts the Firebase emulators (firestore + storage), then runs Playwright inside them.
 * Playwright's global setup resets + seeds the emulator; its webServer runs `next start -p 3100`
 * on the build from `npm run test:e2e:build`. Needs Java 21 on PATH for the emulators.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".next/BUILD_ID")) {
  console.error("No production build found. Run `npm run test:e2e:build` first.");
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.some((a) => /["\s]/.test(a))) {
  console.error("Pass Playwright arguments without spaces or quotes (e.g. --project=desktop tests/e2e/auth.spec.ts).");
  process.exit(2);
}
const inner = ["playwright", "test", ...args].join(" ");
// shell: true so `npx` resolves on Windows; the inner command is one double-quoted argument.
const r = spawnSync(`npx firebase emulators:exec --only firestore,storage --project demo-taki "${inner}"`, { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
