/**
 * MemoryDocStore — vitest-only DocStore (P2 §2.1). NEVER imported by app code.
 *
 *  - deep-clones on every read and write;
 *  - supports every WhereOp, orderBy (incl. "__name__") and startAfter cursors;
 *  - transactions use optimistic concurrency: every doc read (and every collection
 *    queried) is version-checked at commit; on conflict the transaction function is
 *    re-run (up to maxAttempts), reproducing Firestore's "conflicting transaction
 *    retries" behaviour that the concurrency tests rely on;
 *  - reads yield to the event loop so `Promise.all` really interleaves transactions;
 *  - enforces reads-before-writes;
 *  - checks multi-field queries against firestore.indexes.json (throws `missing_index`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DomainError } from "@/lib/api/contracts/errors";
import type { BatchOp, ColPath, DocStore, QuerySpec, TxContext, Where } from "@/server/db/docstore";
import { DOC_ID_FIELD, ReadAfterWriteError } from "@/server/db/docstore";

interface Stored {
  v: number;
  doc: Record<string, unknown>;
}

interface IndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}
interface IndexDef {
  collectionGroup: string;
  fields: IndexField[];
}

export interface MemoryDocStoreOptions {
  /** Index definitions to enforce; default: the repo's firestore.indexes.json. `false` disables. */
  indexes?: IndexDef[] | false;
  /** Yield to the event loop on each read (default true) so concurrent transactions interleave. */
  yieldOnRead?: boolean;
}

let cachedIndexes: IndexDef[] | null = null;
export function loadRepoIndexes(): IndexDef[] {
  if (!cachedIndexes) {
    const file = path.resolve(__dirname, "../../firestore.indexes.json");
    cachedIndexes = (JSON.parse(readFileSync(file, "utf8")) as { indexes: IndexDef[] }).indexes;
  }
  return cachedIndexes;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const tick = () => new Promise<void>((r) => setImmediate(r));

function getField(doc: Record<string, unknown>, id: string, field: string): unknown {
  if (field === DOC_ID_FIELD) return id;
  let cur: unknown = doc;
  for (const part of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function typeRank(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (v instanceof Date) return 3;
  if (typeof v === "string") return 4;
  if (Array.isArray(v)) return 6;
  return 7;
}

function cmp(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function eq(a: unknown, b: unknown): boolean {
  return typeRank(a) === typeRank(b) && cmp(a, b) === 0;
}

function matches(doc: Record<string, unknown>, id: string, [field, op, value]: Where): boolean {
  const v = getField(doc, id, field);
  if (v === undefined) return false;
  switch (op) {
    case "==":
      return eq(v, value);
    case "!=":
      return v !== null && !eq(v, value);
    case "<":
      return typeRank(v) === typeRank(value) && cmp(v, value) < 0;
    case "<=":
      return typeRank(v) === typeRank(value) && cmp(v, value) <= 0;
    case ">":
      return typeRank(v) === typeRank(value) && cmp(v, value) > 0;
    case ">=":
      return typeRank(v) === typeRank(value) && cmp(v, value) >= 0;
    case "in":
      return (value as unknown[]).some((x) => eq(v, x));
    case "not-in":
      return v !== null && !(value as unknown[]).some((x) => eq(v, x));
    case "array-contains":
      return Array.isArray(v) && v.some((x) => eq(x, value));
    case "array-contains-any":
      return Array.isArray(v) && v.some((x) => (value as unknown[]).some((y) => eq(x, y)));
  }
}

function setPath(doc: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === null || typeof next !== "object" || Array.isArray(next)) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = clone(value);
}

/** Firestore with ignoreUndefinedProperties drops undefined fields; mirror that. */
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripUndefined(x)) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = stripUndefined(val);
    return out as T;
  }
  return v;
}

type PendingWrite =
  | { kind: "create" | "set"; col: string; id: string; data: Record<string, unknown> }
  | { kind: "update"; col: string; id: string; patch: Record<string, unknown> }
  | { kind: "delete"; col: string; id: string };

export class MemoryDocStore implements DocStore {
  readonly kind = "memory" as const;
  private readonly cols = new Map<string, Map<string, Stored>>();
  private readonly colVersions = new Map<string, number>();
  private seq = 0;
  private readonly indexes: IndexDef[] | false;
  private readonly yieldOnRead: boolean;
  /** Number of transaction retries caused by conflicts (for tests/diagnostics). */
  conflicts = 0;

  constructor(opts: MemoryDocStoreOptions = {}) {
    this.indexes = opts.indexes === undefined ? loadRepoIndexes() : opts.indexes;
    this.yieldOnRead = opts.yieldOnRead ?? true;
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private col(c: string): Map<string, Stored> {
    let m = this.cols.get(c);
    if (!m) {
      m = new Map();
      this.cols.set(c, m);
    }
    return m;
  }

  private version(c: string, id: string): number {
    return this.cols.get(c)?.get(id)?.v ?? 0;
  }

  private colVersion(c: string): number {
    return this.colVersions.get(c) ?? 0;
  }

  private bump(c: string): number {
    this.seq += 1;
    this.colVersions.set(c, this.seq);
    return this.seq;
  }

  private readDoc<T>(c: string, id: string): T | null {
    const s = this.cols.get(c)?.get(id);
    return s ? (clone(s.doc) as T) : null;
  }

  private runQuery<T>(c: string, q: QuerySpec): Array<{ id: string; doc: T }> {
    this.checkIndex(c, q);
    const all = [...(this.cols.get(c)?.entries() ?? [])];
    let rows = all.filter(([id, s]) => (q.where ?? []).every((w) => matches(s.doc, id, w)));
    const orderBy = q.orderBy ?? [];
    // Firestore excludes docs missing an orderBy field.
    rows = rows.filter(([id, s]) => orderBy.every(([f]) => getField(s.doc, id, f) !== undefined));
    rows.sort(([ida, a], [idb, b]) => {
      for (const [f, dir] of orderBy) {
        const r = cmp(getField(a.doc, ida, f), getField(b.doc, idb, f));
        if (r !== 0) return dir === "desc" ? -r : r;
      }
      return ida < idb ? -1 : ida > idb ? 1 : 0;
    });
    if (q.startAfter && q.startAfter.length > 0) {
      const cursor = q.startAfter;
      rows = rows.filter(([id, s]) => {
        for (let i = 0; i < cursor.length; i++) {
          const [f, dir] = orderBy[i] ?? [DOC_ID_FIELD, "asc"];
          const r = cmp(getField(s.doc, id, f), cursor[i]);
          if (r !== 0) return dir === "desc" ? r < 0 : r > 0;
        }
        return false;
      });
    }
    if (q.limit !== undefined) rows = rows.slice(0, q.limit);
    return rows.map(([id, s]) => ({ id, doc: clone(s.doc) as T }));
  }

  /** Throws DomainError-like `missing_index` when a composite index would be required but is absent. */
  private checkIndex(c: string, q: QuerySpec): void {
    if (!this.indexes) return;
    const group = c.split("/").length > 1 ? c.split("/").pop()! : c;
    const where = q.where ?? [];
    const eqFields = where.filter(([, op]) => op === "==" || op === "in").map(([f]) => f);
    const arrayFields = where.filter(([, op]) => op === "array-contains" || op === "array-contains-any").map(([f]) => f);
    const rangeFields = where.filter(([, op]) => ["<", "<=", ">", ">=", "!=", "not-in"].includes(op)).map(([f]) => f);
    const orderFields = (q.orderBy ?? []).map(([f]) => f).filter((f) => f !== DOC_ID_FIELD);
    const tail = [...new Set([...rangeFields, ...orderFields])];
    const head = [...new Set([...eqFields, ...arrayFields])].filter((f) => !tail.includes(f));
    if (tail.length === 0) return; // equality/array-contains only → index merging, no composite needed
    if (head.length === 0 && tail.length === 1) return; // single-field index
    const required = new Set([...head, ...tail]);
    const ok = this.indexes.some((ix) => {
      if (ix.collectionGroup !== group) return false;
      const paths = ix.fields.map((f) => f.fieldPath);
      if (paths.length !== required.size || !paths.every((p) => required.has(p))) return false;
      const ixTail = paths.slice(paths.length - tail.length);
      if (ixTail.join("|") !== tail.join("|")) return false;
      return arrayFields.every((af) => ix.fields.find((f) => f.fieldPath === af)?.arrayConfig === "CONTAINS");
    });
    if (!ok) {
      const err = new Error(
        `missing_index: collection "${group}" needs a composite index on [${[...head, ...tail].join(", ")}] (order fields: ${tail.join(", ")}). Add it to firestore.indexes.json.`,
      );
      err.name = "MissingIndexError";
      throw err;
    }
  }

  private applyWrites(writes: PendingWrite[]): void {
    for (const w of writes) {
      const m = this.col(w.col);
      const existing = m.get(w.id);
      if (w.kind === "create" && existing) throw new DomainError("already_exists");
      if (w.kind === "update" && !existing) throw new DomainError("not_found", `No document to update: ${w.col}/${w.id}`);
    }
    for (const w of writes) {
      const m = this.col(w.col);
      const v = this.bump(w.col);
      if (w.kind === "delete") m.delete(w.id);
      else if (w.kind === "update") {
        const doc = clone(m.get(w.id)!.doc);
        for (const [k, val] of Object.entries(w.patch)) setPath(doc, k, val);
        m.set(w.id, { v, doc });
      } else m.set(w.id, { v, doc: stripUndefined(clone(w.data)) });
    }
  }

  // ── DocStore ───────────────────────────────────────────────────────────────
  async get<T>(c: ColPath, id: string): Promise<T | null> {
    if (this.yieldOnRead) await tick();
    return this.readDoc<T>(c, id);
  }

  async getMany<T>(c: ColPath, ids: readonly string[]): Promise<Array<T | null>> {
    if (this.yieldOnRead) await tick();
    return ids.map((id) => this.readDoc<T>(c, id));
  }

  async query<T>(c: ColPath, q: QuerySpec): Promise<T[]> {
    if (this.yieldOnRead) await tick();
    return this.runQuery<T>(c, q).map((r) => r.doc);
  }

  async count(c: ColPath, q: QuerySpec): Promise<number> {
    if (this.yieldOnRead) await tick();
    return this.runQuery(c, { where: q.where }).length;
  }

  async sum(c: ColPath, field: string, q: QuerySpec): Promise<number> {
    if (this.yieldOnRead) await tick();
    return this.runQuery<Record<string, unknown>>(c, { where: q.where }).reduce((s, r) => {
      const v = getField(r.doc, r.id, field);
      return s + (typeof v === "number" ? v : 0);
    }, 0);
  }

  async runTransaction<T>(fn: (tx: TxContext) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
    const maxAttempts = opts?.maxAttempts ?? 5;
    for (let attempt = 1; ; attempt++) {
      const reads = new Map<string, number>(); // "col\0id" → version
      const queried = new Map<string, number>(); // col → collection version
      const writes: PendingWrite[] = [];
      const stale = () =>
        [...reads].some(([key, v]) => {
          const [c, id] = key.split("\0") as [string, string];
          return this.version(c, id) !== v;
        }) || [...queried].some(([c, v]) => this.colVersion(c) !== v);
      const assertReading = () => {
        if (writes.length > 0) throw new ReadAfterWriteError();
      };
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- tx methods are generic object methods
      const store = this;
      const tx: TxContext = {
        async get<D>(c: ColPath, id: string) {
          assertReading();
          const key = `${c}\0${id}`;
          if (!reads.has(key)) reads.set(key, store.version(c, id));
          const doc = store.readDoc<D>(c, id);
          // Snapshot first, then yield: concurrent transactions really read the same version.
          if (store.yieldOnRead) await tick();
          return doc;
        },
        async getMany<D>(c: ColPath, ids: readonly string[]) {
          assertReading();
          const docs = ids.map((id) => {
            const key = `${c}\0${id}`;
            if (!reads.has(key)) reads.set(key, store.version(c, id));
            return store.readDoc<D>(c, id);
          });
          if (store.yieldOnRead) await tick();
          return docs;
        },
        async query<D>(c: ColPath, q: QuerySpec) {
          assertReading();
          if (!queried.has(c)) queried.set(c, store.colVersion(c));
          const rows = store.runQuery<D>(c, q);
          for (const r of rows) {
            const key = `${c}\0${r.id}`;
            if (!reads.has(key)) reads.set(key, store.version(c, r.id));
          }
          if (store.yieldOnRead) await tick();
          return rows.map((r) => r.doc);
        },
        create(c, id, data) {
          writes.push({ kind: "create", col: c, id, data: clone(data) as Record<string, unknown> });
        },
        set(c, id, data) {
          writes.push({ kind: "set", col: c, id, data: clone(data) as Record<string, unknown> });
        },
        update(c, id, patch) {
          writes.push({ kind: "update", col: c, id, patch: clone(patch) });
        },
        delete(c, id) {
          writes.push({ kind: "delete", col: c, id });
        },
      };

      let result: T;
      try {
        result = await fn(tx);
      } catch (e) {
        // A decision taken on stale data is retried, like Firestore would have serialised it.
        if (stale() && attempt < maxAttempts && !(e instanceof ReadAfterWriteError)) {
          this.conflicts += 1;
          continue;
        }
        throw e;
      }
      // Commit atomically (synchronous: no other task can run in between).
      if (!stale()) {
        this.applyWrites(writes);
        return result;
      }
      this.conflicts += 1;
      if (attempt >= maxAttempts) throw new DomainError("contention");
    }
  }

  async batchWrite(ops: readonly BatchOp[]): Promise<void> {
    const writes: PendingWrite[] = ops.map((o) =>
      o.op === "delete"
        ? { kind: "delete", col: o.col, id: o.id }
        : o.op === "update"
          ? { kind: "update", col: o.col, id: o.id, patch: clone(o.data as Record<string, unknown>) }
          : { kind: o.op, col: o.col, id: o.id, data: clone(o.data as Record<string, unknown>) },
    );
    this.applyWrites(writes);
  }

  // ── test helpers ───────────────────────────────────────────────────────────
  /** Snapshot of a collection (cloned), keyed by id. */
  dump<T = Record<string, unknown>>(c: string): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [id, s] of this.cols.get(c) ?? []) out[id] = clone(s.doc) as T;
    return out;
  }

  /** All docs of a collection (cloned). */
  all<T = Record<string, unknown>>(c: string): T[] {
    return Object.values(this.dump<T>(c));
  }

  /** Direct synchronous write for fixtures (bypasses transactions). */
  put<T>(c: string, id: string, doc: T): void {
    this.col(c).set(id, { v: this.bump(c), doc: stripUndefined(clone(doc)) as Record<string, unknown> });
  }

  clear(): void {
    this.cols.clear();
    this.colVersions.clear();
  }
}
