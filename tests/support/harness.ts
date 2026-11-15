/**
 * Store harness for core/payments suites (D5). The same test files run on:
 *  - the MemoryDocStore (`npm test`, default), and
 *  - the Firestore emulator (`npm run test:emulator`, TAKI_TEST_STORE=emulator), where every
 *    test starts from an empty database (emulator REST reset).
 */
import { clearAfterTasks, flushAfterTasks } from "@/server/http/after";
import { setPaymentGatewayForTests } from "@/server/payments/gateway";
import { getDocStore, setDocStoreForTests, type DocStore } from "@/server/db";
import { setTestNow } from "@/server/clock";
import { MemoryDocStore } from "./memory-docstore";

export const ON_EMULATOR = process.env.TAKI_TEST_STORE === "emulator";

/** Collection names read back by tests (Firestore has no "dump"). */
export async function all<T>(col: string): Promise<T[]> {
  return getDocStore().query<T>(col, {});
}

async function resetEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("TAKI_TEST_STORE=emulator but FIRESTORE_EMULATOR_HOST is not set (run via `npm run test:emulator`).");
  const project = process.env.GCLOUD_PROJECT ?? "demo-taki";
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Emulator reset failed: ${res.status}`);
}

/** A fresh, empty store injected as the app's DocStore. Call in beforeEach. */
export async function freshStore(): Promise<DocStore> {
  clearAfterTasks();
  setPaymentGatewayForTests(null);
  setTestNow(null);
  if (ON_EMULATOR) {
    setDocStoreForTests(null);
    await resetEmulator();
    return getDocStore();
  }
  const store = new MemoryDocStore();
  setDocStoreForTests(store);
  return store;
}

/** Run queued post-commit work (refund jobs etc.). */
export async function flushAfter(): Promise<number> {
  return flushAfterTasks();
}

/** Settles every promise and splits fulfilled values from rejection codes. */
export async function settle<T>(ps: ReadonlyArray<Promise<T>>): Promise<{ ok: T[]; errors: string[] }> {
  const rs = await Promise.allSettled(ps);
  const ok: T[] = [];
  const errors: string[] = [];
  for (const r of rs) {
    if (r.status === "fulfilled") ok.push(r.value);
    else errors.push((r.reason as { code?: string })?.code ?? String(r.reason));
  }
  return { ok, errors };
}

/** Deterministic PRNG (mulberry32) for seeded interleavings. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
