import "server-only";
/**
 * Uploads (P2 §4.7): magic-byte type check, size limits, server-generated path
 *   private/{ownerType}/{ownerId}/{kind}/{fileId}.{ext}
 * and a `files/{fileId}` metadata doc. Never trust the client's MIME type or filename.
 */
import { createHash } from "node:crypto";
import { DomainError } from "@/lib/api/contracts/errors";
import { UPLOAD_LIMITS } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import type { FileContentType, FileKind, FileOwnerType } from "@/lib/domain/model";
import { C } from "../db/collections";
import { getDocStore } from "../db";
import type { FileDoc } from "../db/schema";
import { getFileStore } from "./filestore";

const EXT: Record<FileContentType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Detect the real type from magic bytes. */
export function sniffContentType(b: Uint8Array): FileContentType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}

const DOC_KINDS: readonly FileKind[] = ["aadhaar", "pan", "driving_license"];

export function rulesFor(kind: FileKind): { maxBytes: number; types: readonly FileContentType[] } {
  if (DOC_KINDS.includes(kind)) return { maxBytes: UPLOAD_LIMITS.documentBytes, types: ["image/jpeg", "image/png", "image/webp", "application/pdf"] };
  if (kind === "delivery_proof") return { maxBytes: UPLOAD_LIMITS.proofBytes, types: ["image/jpeg", "image/png", "image/webp"] };
  return { maxBytes: UPLOAD_LIMITS.photoBytes, types: ["image/jpeg", "image/png", "image/webp"] };
}

export interface SaveUploadInput {
  /** A `File` from `formData.get(...)`, or raw bytes. */
  file: File | Blob | Uint8Array;
  kind: FileKind;
  ownerType: FileOwnerType;
  ownerId: string;
  uploadedBy: string;
  now: Date;
  /** Field name for error messages. */
  field?: string;
  /** Seed files only. */
  sample?: boolean;
}

async function bytesOf(f: File | Blob | Uint8Array): Promise<Uint8Array> {
  return f instanceof Uint8Array ? f : new Uint8Array(await f.arrayBuffer());
}

/** Validate bytes for a kind; throws file_invalid / file_too_large. */
export function validateUpload(bytes: Uint8Array, kind: FileKind, field = "file"): FileContentType {
  const rules = rulesFor(kind);
  if (bytes.length === 0) throw new DomainError("file_invalid", "The file is empty.", { fields: { [field]: "The file is empty" } });
  if (bytes.length > rules.maxBytes)
    throw new DomainError("file_too_large", `Files must be ${Math.round(rules.maxBytes / 1024 / 1024)} MB or smaller.`, { fields: { [field]: "Too large" } });
  const type = sniffContentType(bytes);
  if (!type || !rules.types.includes(type))
    throw new DomainError("file_invalid", rules.types.includes("application/pdf") ? "Upload a JPG, PNG, WEBP or PDF file." : "Upload a JPG, PNG or WEBP image.", {
      fields: { [field]: "Unsupported file type" },
    });
  return type;
}

/** Store bytes + metadata. Returns the FileDoc (status active). */
export async function saveUpload(i: SaveUploadInput): Promise<FileDoc> {
  const bytes = await bytesOf(i.file);
  const contentType = validateUpload(bytes, i.kind, i.field);
  const id = newId("fil");
  const storagePath = `private/${i.ownerType}/${i.ownerId}/${i.kind}/${id}.${EXT[contentType]}`;
  await getFileStore().put(storagePath, bytes, contentType);
  const at = i.now.toISOString();
  const doc: FileDoc = {
    id,
    ownerType: i.ownerType,
    ownerId: i.ownerId,
    uploadedBy: i.uploadedBy,
    kind: i.kind,
    storagePath,
    contentType,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    status: "active",
    sample: i.sample ?? false,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await getDocStore().batchWrite([{ op: "create", col: C.files, id, data: doc }]);
  } catch (e) {
    await getFileStore().delete(storagePath).catch(() => undefined);
    throw e;
  }
  return doc;
}

/** Delete uploads (e.g. delivery proof after a failed OTP). Best effort. */
export async function discardUploads(fileIds: readonly string[], now: Date): Promise<void> {
  if (fileIds.length === 0) return;
  const store = getDocStore();
  const docs = await store.getMany<FileDoc>(C.files, fileIds);
  for (const d of docs) {
    if (!d) continue;
    await getFileStore().delete(d.storagePath).catch(() => undefined);
    await store.batchWrite([{ op: "update", col: C.files, id: d.id, data: { status: "deleted", updatedAt: now.toISOString() } }]);
  }
}

/** Mark an older file replaced (profile photo change etc.). */
export async function markReplaced(fileId: string, now: Date): Promise<void> {
  await getDocStore().batchWrite([{ op: "update", col: C.files, id: fileId, data: { status: "replaced", updatedAt: now.toISOString() } }]);
}

/** Read a `File` entry from FormData or throw a field error. */
export function formFile(form: FormData, name: string, required: true): File;
export function formFile(form: FormData, name: string, required?: false): File | null;
export function formFile(form: FormData, name: string, required = false): File | null {
  const v = form.get(name);
  if (v && typeof v !== "string" && v.size > 0) return v as File;
  if (required) throw new DomainError("invalid_request", "A required file is missing.", { fields: { [name]: "Required" } });
  return null;
}

export function formFiles(form: FormData, name: string): File[] {
  return form.getAll(name).filter((v): v is File => typeof v !== "string" && v.size > 0);
}
