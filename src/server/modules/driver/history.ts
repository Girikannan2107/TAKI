import "server-only";
/** Driver history (P2 §8.6): delivered shipments (delivery records), newest first. */
import type { z } from "zod";
import { fileUrl } from "@/lib/api/contracts/common";
import type { DriverHistoryDTO, DriverHistoryItem, DriverHistoryQuery } from "@/lib/api/contracts/driver";
import type { SessionContext } from "@/server/auth/guards";
import type { Where } from "@/server/db";
import { C, getDocStore, sub } from "@/server/db";
import type { BookingDoc, BookingEventDoc } from "@/server/db/schema";
import { decodeCursor, pageOf } from "@/server/http/cursor";
import { isVisibleToDriver } from "@/server/views/driver";
import { loadDriver } from "./access";
import { toListItems } from "./shipments";

const IST_OFFSET = "+05:30";

/** "TAKI123456", "taki123456", "123456" → "TAKI123456"; anything else → null. */
export function normalizeBookingQuery(q: string | undefined): string | null {
  if (!q) return null;
  const s = q.trim().toUpperCase().replace(/\s+/g, "");
  if (/^TAKI\d{6}$/.test(s)) return s;
  if (/^\d{6}$/.test(s)) return `TAKI${s}`;
  return null;
}

/** IST calendar month "2026-11" → [start, end) as UTC ISO strings. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const from = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00${IST_OFFSET}`).toISOString();
  const to = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00${IST_OFFSET}`).toISOString();
  return { from, to };
}

/** List items + the first proof photo of each delivery (one small events read per row, page ≤ 50). */
async function withProof(rows: readonly BookingDoc[]): Promise<DriverHistoryItem[]> {
  const store = getDocStore();
  const [items, proofs] = await Promise.all([
    toListItems(rows),
    Promise.all(
      rows.map(async (b) => {
        const evs = await store.query<BookingEventDoc>(sub.bookingEvents(b.id), { where: [["type", "==", "delivered"]], limit: 1 });
        const f = evs[0]?.files[0];
        return f ? fileUrl(f.fileId) : null;
      }),
    ),
  ]);
  return items.map((it, i) => ({ ...it, proofThumbUrl: proofs[i] ?? null }));
}

/**
 * Delivered bookings for this driver. Records stay visible even if the agency link changes later.
 * `q` is a booking id; `month` filters by the booking's last update (= delivery for delivered bookings).
 */
export async function listHistory(session: SessionContext, query: z.output<typeof DriverHistoryQuery>): Promise<DriverHistoryDTO> {
  await loadDriver(session);
  const store = getDocStore();

  if (query.q) {
    const id = normalizeBookingQuery(query.q);
    if (!id) return { items: [], nextCursor: null };
    const b = await store.get<BookingDoc>(C.bookings, id);
    if (!b || b.status !== "delivered" || !isVisibleToDriver(b, session.userId)) return { items: [], nextCursor: null };
    return { items: await withProof([b]), nextCursor: null };
  }

  const where: Where[] = [
    ["driverId", "==", session.userId],
    ["status", "==", "delivered"],
  ];
  if (query.month) {
    const { from, to } = monthRange(query.month);
    where.push(["updatedAt", ">=", from], ["updatedAt", "<", to]);
  }
  const rows = await store.query<BookingDoc>(C.bookings, {
    where,
    orderBy: [
      ["updatedAt", "desc"],
      ["__name__", "desc"],
    ],
    limit: query.limit + 1,
    startAfter: decodeCursor(query.cursor),
  });
  const page = pageOf(rows, query.limit, (b) => [b.updatedAt, b.id]);
  return { items: await withProof(page.items), nextCursor: page.nextCursor };
}
