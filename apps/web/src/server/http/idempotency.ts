import "server-only";
/**
 * Idempotency keys (P2 §6.3). Used INSIDE the business transaction:
 *
 *   const idem = idempotencyRef("booking", userId, key, { shipmentId, tripId });
 *   const replay = await readIdempotency(tx, idem);      // first, with the other reads
 *   if (replay) return replay.body;                       // same key + same body → stored result
 *   …business writes…
 *   writeIdempotency(tx, idem, 201, { bookingId }, now);  // same transaction
 *
 * Same key with a different body → DomainError("idempotency_key_reused") (422).
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { IdempotencyKeyHeader } from "@/lib/api/contracts/common";
import { C } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { IdempotencyDoc } from "../db/schema";
import { sha256Hex, stableStringify } from "./crypto";

const TTL_HOURS = 24;

export interface IdempotencyRef {
  id: string;
  scope: string;
  userId: string;
  requestHash: string;
}

export function idempotencyRef(scope: string, userId: string, key: string, request: unknown): IdempotencyRef {
  const raw = `${scope}:${userId}:${key}`;
  return {
    id: raw.length <= 200 ? raw.replace(/\//g, "_") : sha256Hex(raw),
    scope,
    userId,
    requestHash: sha256Hex(stableStringify(request)),
  };
}

/** Header value or throws `idempotency_key_required` / `invalid_request`. */
export function requireIdempotencyKey(req: Request): string {
  const v = req.headers.get("idempotency-key");
  if (!v) throw new DomainError("idempotency_key_required");
  const parsed = IdempotencyKeyHeader.safeParse(v);
  if (!parsed.success) throw new DomainError("invalid_request", "Invalid Idempotency-Key header.", { fields: { "Idempotency-Key": "Invalid" } });
  return parsed.data;
}

export async function readIdempotency(tx: TxContext, ref: IdempotencyRef, now: Date): Promise<{ status: number; body: unknown } | null> {
  const doc = await tx.get<IdempotencyDoc>(C.idempotency, ref.id);
  if (!doc || Date.parse(doc.expiresAt) <= now.getTime()) return null;
  if (doc.requestHash !== ref.requestHash) throw new DomainError("idempotency_key_reused");
  return { status: doc.status, body: doc.body };
}

export function writeIdempotency(tx: TxContext, ref: IdempotencyRef, status: number, body: unknown, now: Date): void {
  const expires = new Date(now.getTime() + TTL_HOURS * 3_600_000);
  const doc: IdempotencyDoc = {
    id: ref.id,
    scope: ref.scope,
    userId: ref.userId,
    requestHash: ref.requestHash,
    status,
    body,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    expiresAtTs: expires,
  };
  tx.set(C.idempotency, ref.id, doc);
}
