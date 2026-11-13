import "server-only";
/** Binary file storage (P2 §2.1). Firebase Storage in emulator/production; MemoryFileStore in vitest. */

export interface FileStore {
  readonly kind: "firebase-storage" | "memory";
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(path: string): Promise<void>;
}

const g = globalThis as unknown as { __takiFileStore?: FileStore; __takiTestFileStore?: FileStore | null };

export function getFileStore(): FileStore {
  if (g.__takiTestFileStore) return g.__takiTestFileStore;
  if (!g.__takiFileStore) {
    // Lazy require keeps firebase-admin/storage out of code paths that never touch files.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FirebaseStorageFileStore } = require("./firebase-storage") as typeof import("./firebase-storage");
    g.__takiFileStore = new FirebaseStorageFileStore();
  }
  return g.__takiFileStore;
}

/** Vitest only. */
export function setFileStoreForTests(store: FileStore | null): void {
  if (process.env.VITEST !== "true") throw new Error("setFileStoreForTests() is only allowed under vitest");
  g.__takiTestFileStore = store;
}
