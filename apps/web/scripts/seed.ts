/**
 * `npm run seed [-- --reset] [-- --allow-remote]` — development dataset (P2 §11).
 *
 * Runs against the Firebase emulators (`npm run emulators` first; .env.development sets
 * FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST). Refuses any real project unless
 * `--allow-remote` AND SEED_ALLOW_REMOTE=1 AND the project is not FIREBASE_PROD_PROJECT_ID.
 *
 * Demo accounts (password SEED_PASSWORD, default "Taki@2026" — dev only, never production):
 *   admin     9000000001  TAKI Ops (hidden /admin)
 *   customer  9876543210  Priya Raman (confirmed pickups on the demo driver's trips, history)
 *   driver    9876543211  Ravi Kumar, approved, Kovai Freight Lines (trip in progress today)
 *   agency    9876543220  Kovai Freight Lines (verified)
 *   pending agency 9000000301 (Kochi Coastal Logistics, documents uploaded)
 *   pending driver 9000000113 (Senthil Nathan, self-registered, awaiting Kovai's approval)
 * The full list is printed and written to .data/seed-accounts.txt (gitignored).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAdminBucket } from "@/server/firebase/admin";
import { SEED_DEFAULT_PASSWORD, runSeed } from "@/server/seed";

const args = new Set(process.argv.slice(2));
const ROOT = path.resolve(__dirname, "..");

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function guard(): void {
  if (process.env.NODE_ENV === "production") fail("Refusing to seed with NODE_ENV=production.");
  if (process.env.FIRESTORE_EMULATOR_HOST) return;
  if (!args.has("--allow-remote") || process.env.SEED_ALLOW_REMOTE !== "1")
    fail("FIRESTORE_EMULATOR_HOST is not set. Start the emulators (`npm run emulators`) or pass --allow-remote with SEED_ALLOW_REMOTE=1.");
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!project || project === process.env.FIREBASE_PROD_PROJECT_ID) fail("Refusing to seed the production project.");
}

async function resetEmulators(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) fail("--reset only works against the emulator.");
  const res = await fetch(`http://${host}/emulator/v1/projects/demo-taki/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) fail(`Firestore emulator reset failed (${res.status}).`);
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    try {
      await getAdminBucket().deleteFiles({ prefix: "private/", force: true });
    } catch (e) {
      console.warn("  (storage reset skipped)", (e as Error).message);
    }
  }
  console.log("✓ emulators cleared");
}

async function main(): Promise<void> {
  guard();
  if (args.has("--reset")) await resetEmulators();
  const password = process.env.SEED_PASSWORD?.trim() || SEED_DEFAULT_PASSWORD;
  const started = Date.now();
  const r = await runSeed({ now: new Date(), password, assetsDir: path.join(ROOT, "scripts/seed/assets"), log: (l) => console.log(`  · ${l}`) });

  const rows = r.accounts.map((a) => [a.role.padEnd(8), a.phone.padEnd(11), a.name.padEnd(22), a.note]);
  const table = ["role     phone       name                   note", ...rows.map((c) => c.join(" "))].join("\n");
  console.log(`\nSeeded in ${((Date.now() - started) / 1000).toFixed(1)} s. Password for every account: ${password}\n\n${table}\n`);
  console.log(Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join("  "));
  const dir = path.join(ROOT, ".data");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "seed-accounts.txt"), `TAKI dev seed — ${new Date().toISOString()}\nPassword: ${password}\n\n${table}\n`, "utf8");
  console.log(`\nWritten to .data/seed-accounts.txt`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
