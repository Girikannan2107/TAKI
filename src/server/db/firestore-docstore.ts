import "server-only";
/** DocStore over firebase-admin Firestore (emulator and production). */
import {
  AggregateField,
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { DomainError } from "@/lib/api/contracts/errors";
import type { BatchOp, ColPath, DocStore, QuerySpec, TxContext } from "./docstore";
import { DOC_ID_FIELD } from "./docstore";

function fieldRef(field: string): string | FieldPath {
  return field === DOC_ID_FIELD ? FieldPath.documentId() : field;
}

/** Firestore Timestamps (only `expiresAtTs` TTL fields) come back as JS Dates. */
function fromFirestore<T>(data: DocumentData | undefined): T | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = v instanceof Timestamp ? v.toDate() : v;
  return out as T;
}

/** `undefined` values in an update patch delete the field (e.g. removing a hold). */
function toUpdatePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? FieldValue.delete() : v;
  return out;
}

function grpcCode(e: unknown): number | undefined {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "number" ? c : undefined;
}

function mapError(e: unknown): unknown {
  if (e instanceof DomainError) return e;
  const code = grpcCode(e);
  if (code === 6) return new DomainError("already_exists"); // ALREADY_EXISTS
  if (code === 5) return new DomainError("not_found"); // NOT_FOUND (update of a missing doc)
  if (code === 10) return new DomainError("contention"); // ABORTED after SDK retries
  return e;
}

export class FirestoreDocStore implements DocStore {
  readonly kind = "firestore" as const;

  constructor(private readonly db: Firestore) {}

  private buildQuery(col: ColPath, q: QuerySpec): Query {
    let query: Query = this.db.collection(col);
    for (const [field, op, value] of q.where ?? []) query = query.where(fieldRef(field), op, value);
    for (const [field, dir] of q.orderBy ?? []) query = query.orderBy(fieldRef(field), dir);
    if (q.startAfter && q.startAfter.length > 0) query = query.startAfter(...q.startAfter);
    if (q.limit !== undefined) query = query.limit(q.limit);
    return query;
  }

  async get<T>(col: ColPath, id: string): Promise<T | null> {
    const snap = await this.db.collection(col).doc(id).get();
    return fromFirestore<T>(snap.data());
  }

  async getMany<T>(col: ColPath, ids: readonly string[]): Promise<Array<T | null>> {
    if (ids.length === 0) return [];
    const refs = ids.map((id) => this.db.collection(col).doc(id));
    const snaps = await this.db.getAll(...refs);
    return snaps.map((s) => fromFirestore<T>(s.data()));
  }

  async query<T>(col: ColPath, q: QuerySpec): Promise<T[]> {
    const snap = await this.buildQuery(col, q).get();
    return snap.docs.map((d) => fromFirestore<T>(d.data())!);
  }

  async count(col: ColPath, q: QuerySpec): Promise<number> {
    const snap = await this.buildQuery(col, { where: q.where }).count().get();
    return snap.data().count;
  }

  async sum(col: ColPath, field: string, q: QuerySpec): Promise<number> {
    const snap = await this.buildQuery(col, { where: q.where }).aggregate({ total: AggregateField.sum(field) }).get();
    return Number(snap.data().total ?? 0);
  }

  async runTransaction<T>(fn: (tx: TxContext) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
    try {
      return await this.db.runTransaction((t) => fn(this.wrapTx(t)), { maxAttempts: opts?.maxAttempts ?? 5 });
    } catch (e) {
      throw mapError(e);
    }
  }

  private wrapTx(t: Transaction): TxContext {
    const db = this.db;
    const ref = (col: ColPath, id: string) => db.collection(col).doc(id);
    const build = (col: ColPath, q: QuerySpec) => this.buildQuery(col, q);
    return {
      async get<T>(col: ColPath, id: string) {
        const snap = await t.get(ref(col, id));
        return fromFirestore<T>(snap.data());
      },
      async getMany<T>(col: ColPath, ids: readonly string[]) {
        if (ids.length === 0) return [];
        const snaps = await t.getAll(...ids.map((id) => ref(col, id)));
        return snaps.map((s) => fromFirestore<T>(s.data()));
      },
      async query<T>(col: ColPath, q: QuerySpec) {
        const snap = await t.get(build(col, q));
        return snap.docs.map((d) => fromFirestore<T>(d.data())!);
      },
      create(col, id, data) {
        t.create(ref(col, id), data as DocumentData);
      },
      set(col, id, data) {
        t.set(ref(col, id), data as DocumentData);
      },
      update(col, id, patch) {
        t.update(ref(col, id), toUpdatePatch(patch));
      },
      delete(col, id) {
        t.delete(ref(col, id));
      },
    };
  }

  async batchWrite(ops: readonly BatchOp[]): Promise<void> {
    for (let i = 0; i < ops.length; i += 500) {
      const batch = this.db.batch();
      for (const o of ops.slice(i, i + 500)) {
        const r = this.db.collection(o.col).doc(o.id);
        if (o.op === "set") batch.set(r, o.data as DocumentData);
        else if (o.op === "create") batch.create(r, o.data as DocumentData);
        else if (o.op === "update") batch.update(r, toUpdatePatch(o.data as Record<string, unknown>));
        else batch.delete(r);
      }
      try {
        await batch.commit();
      } catch (e) {
        throw mapError(e);
      }
    }
  }
}
