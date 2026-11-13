import "server-only";
/**
 * Customer payment history (D3, read-only). Creating, verifying and confirming payments is
 * D5's payments service (`/api/payments/**`); nothing here can change a payment.
 */
import type { PaymentHistoryItem } from "@/lib/api/contracts/customer";
import type { Page } from "@/lib/api/contracts/common";
import type { SessionContext } from "../../auth/guards";
import { C } from "../../db/collections";
import { getDocStore } from "../../db";
import type { BookingDoc, PaymentDoc } from "../../db/schema";
import { decodeCursor, pageOf } from "../../http/cursor";
import { toPaymentHistoryItem } from "../../views/customer";

export async function listPayments(session: SessionContext, q: { cursor?: string; limit: number }): Promise<Page<PaymentHistoryItem>> {
  const store = getDocStore();
  const rows = await store.query<PaymentDoc>(C.payments, {
    where: [["customerId", "==", session.userId]],
    orderBy: [
      ["createdAt", "desc"],
      ["__name__", "desc"],
    ],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const page = pageOf(rows, q.limit, (p) => [p.createdAt, p.id]);
  const ids = [...new Set(page.items.map((p) => p.bookingId))];
  const bookings = ids.length ? await store.getMany<BookingDoc>(C.bookings, ids) : [];
  const byId = new Map(bookings.filter((b): b is BookingDoc => !!b && b.customerId === session.userId).map((b) => [b.id, b]));
  return { items: page.items.map((p) => toPaymentHistoryItem(p, byId.get(p.bookingId) ?? null)), nextCursor: page.nextCursor };
}
