import "server-only";
/**
 * Opaque pagination cursors (P2 §8.1): base64url(JSON array of the last row's orderBy
 * values + its id). Use with QuerySpec `orderBy: [..., ["__name__", dir]]`.
 */
import { DomainError } from "@/lib/api/contracts/errors";

export function encodeCursor(values: readonly unknown[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): unknown[] | undefined {
  if (!cursor) return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(v)) return v;
  } catch {
    // fall through
  }
  throw new DomainError("invalid_request", "Invalid cursor.", { fields: { cursor: "Invalid cursor" } });
}

/**
 * Page helper: query `limit + 1` rows, return `{ items, nextCursor }`.
 *   const rows = await store.query<BookingDoc>(C.bookings, { where, orderBy: [["createdAt","desc"],["__name__","desc"]], limit: limit + 1, startAfter: decodeCursor(cursor) });
 *   return pageOf(rows, limit, (b) => [b.createdAt, b.id]);
 */
export function pageOf<T>(rows: T[], limit: number, cursorValues: (row: T) => unknown[]): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorValues(last)) : null };
}
