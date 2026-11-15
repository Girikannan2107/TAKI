import "server-only";
/** FileStore over the default Firebase Storage bucket (works with the Storage emulator). */
import { getAdminBucket } from "../firebase/admin";
import type { FileStore } from "./filestore";

export class FirebaseStorageFileStore implements FileStore {
  readonly kind = "firebase-storage" as const;

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await getAdminBucket()
      .file(path)
      .save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: "private, no-store" } });
  }

  async get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const file = getAdminBucket().file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [[buf], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
    return { bytes: new Uint8Array(buf), contentType: String(meta.contentType ?? "application/octet-stream") };
  }

  async delete(path: string): Promise<void> {
    await getAdminBucket().file(path).delete({ ignoreNotFound: true });
  }
}
