import "server-only";
/**
 * DocStore — a thin, Firestore-shaped persistence interface (P2 §2.1). Repositories and
 * core services are written once against it; production/emulator use FirestoreDocStore,
 * vitest uses MemoryDocStore (tests/support). Rules:
 *  - timestamps are ISO-8601 strings; money is integer rupees (pricing) / paise (payments);
 *  - no FieldValue sentinels — every mutation is read-modify-write in a transaction;
 *  - inside a transaction all reads happen before the first write.
 *  - Order by "__name__" to order/cursor by document id.
 */

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";
export type Where = readonly [field: string, op: WhereOp, value: unknown];
export type OrderBy = readonly [field: string, dir: "asc" | "desc"];

export interface QuerySpec {
  where?: readonly Where[];
  orderBy?: readonly OrderBy[];
  limit?: number;
  /** Cursor: one value per orderBy entry (include ["__name__", dir] last for a stable id tiebreak). */
  startAfter?: readonly unknown[];
}

/** "bookings" or a subcollection path "bookings/TAKI123456/events". */
export type ColPath = string;

/** The id field every stored document carries. */
export const DOC_ID_FIELD = "__name__";

export interface TxContext {
  get<T>(col: ColPath, id: string): Promise<T | null>;
  getMany<T>(col: ColPath, ids: readonly string[]): Promise<Array<T | null>>;
  query<T>(col: ColPath, q: QuerySpec): Promise<T[]>;
  /** Fails the transaction (DomainError "already_exists") if the doc exists. */
  create<T>(col: ColPath, id: string, data: T): void;
  set<T>(col: ColPath, id: string, data: T): void;
  /** Dotted paths allowed ("holds.TAKI123456"); a value of `undefined` deletes the field. */
  update(col: ColPath, id: string, patch: Record<string, unknown>): void;
  delete(col: ColPath, id: string): void;
}

export type BatchOp = { op: "set" | "create" | "update" | "delete"; col: ColPath; id: string; data?: unknown };

export interface DocStore {
  readonly kind: "firestore" | "memory";
  get<T>(col: ColPath, id: string): Promise<T | null>;
  getMany<T>(col: ColPath, ids: readonly string[]): Promise<Array<T | null>>;
  query<T>(col: ColPath, q: QuerySpec): Promise<T[]>;
  count(col: ColPath, q: QuerySpec): Promise<number>;
  sum(col: ColPath, field: string, q: QuerySpec): Promise<number>;
  /** Retries on contention up to `maxAttempts` (default 5); then DomainError("contention"). */
  runTransaction<T>(fn: (tx: TxContext) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T>;
  /** Non-transactional batch (seed, append-only). Chunked to 500 ops. */
  batchWrite(ops: readonly BatchOp[]): Promise<void>;
}

/** Thrown when a transaction writes before it finished reading. */
export class ReadAfterWriteError extends Error {
  constructor() {
    super("Transaction reads must happen before the first write");
    this.name = "ReadAfterWriteError";
  }
}
