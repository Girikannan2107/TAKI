/** MemoryFileStore — vitest-only FileStore. */
import type { FileStore } from "@/server/files/filestore";

export class MemoryFileStore implements FileStore {
  readonly kind = "memory" as const;
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.files.set(path, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const f = this.files.get(path);
    return f ? { bytes: new Uint8Array(f.bytes), contentType: f.contentType } : null;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}
