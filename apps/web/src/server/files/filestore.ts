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
  if (!g.__takiFileStore) g.__takiFileStore = lazyFirebaseFileStore();
  return g.__takiFileStore;
}

/**
 * Loads firebase-admin/storage on first use, keeping it out of code paths that never touch files.
 * Must be an async `import()`: the bundler emits ./firebase-storage as an async module (firebase-admin
 * is an ESM external), so a synchronous `require()` returns a promise and `new` on it throws in
 * production builds ("i is not a constructor").
 */
function lazyFirebaseFileStore(): FileStore {
  let real: Promise<FileStore> | null = null;
  const load = () =>
    (real ??= import("./firebase-storage").then(({ FirebaseStorageFileStore }) => new FirebaseStorageFileStore()));
  return {
    kind: "firebase-storage",
    put: async (path, bytes, contentType) => (await load()).put(path, bytes, contentType),
    get: async (path) => (await load()).get(path),
    delete: async (path) => (await load()).delete(path),
  };
}

/** Vitest only. */
export function setFileStoreForTests(store: FileStore | null): void {
  if (process.env.VITEST !== "true") throw new Error("setFileStoreForTests() is only allowed under vitest");
  g.__takiTestFileStore = store;
}
