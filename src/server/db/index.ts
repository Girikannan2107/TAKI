import "server-only";
/**
 * DocStore access (P2 §1.2). `getDocStore()` returns the store injected by tests (vitest only),
 * otherwise a FirestoreDocStore over the admin app. There is NO silent memory fallback:
 * without the emulator or credentials, getAdminApp() throws "Start the emulators".
 */
import { getAdminFirestore } from "../firebase/admin";
import type { DocStore } from "./docstore";
import { FirestoreDocStore } from "./firestore-docstore";

export type { DocStore, TxContext, QuerySpec, Where, WhereOp, OrderBy, ColPath, BatchOp } from "./docstore";
export { C, sub, scheduleId, phoneIndexId } from "./collections";

const g = globalThis as unknown as { __takiDocStore?: DocStore; __takiTestDocStore?: DocStore | null };

export function getDocStore(): DocStore {
  if (g.__takiTestDocStore) return g.__takiTestDocStore;
  if (!g.__takiDocStore) g.__takiDocStore = new FirestoreDocStore(getAdminFirestore());
  return g.__takiDocStore;
}

/** Vitest only: inject a store (e.g. MemoryDocStore). Pass null to clear. */
export function setDocStoreForTests(store: DocStore | null): void {
  if (process.env.VITEST !== "true") throw new Error("setDocStoreForTests() is only allowed under vitest");
  g.__takiTestDocStore = store;
}

/** Health info: which backing store is in use (without touching the network). */
export function docStoreKind(): "memory" | "firestore" | "firestore-emulator" {
  if (g.__takiTestDocStore) return "memory";
  return process.env.FIRESTORE_EMULATOR_HOST ? "firestore-emulator" : "firestore";
}
