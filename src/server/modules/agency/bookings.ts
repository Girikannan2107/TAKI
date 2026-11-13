import "server-only";
/**
 * Agency bookings (P2 §8.5). Reads + projections here; accept / reject are cross-role state
 * transitions and go through D5 `core.bookings` (capacity hold, notifications, events).
 */
import {
  AGENCY_BOOKING_TABS,
  AGENCY_TAB_STATUSES,
  type AgencyBookingDTO,
  type AgencyBookingTab,
  type BookingListResponse,
} from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import { bookings as coreBookings } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore, sub } from "@/server/db";
import type { BookingDoc, BookingEventDoc, CustomerDoc, PaymentDoc, ShipmentDoc, TripDoc } from "@/server/db/schema";
import { decodeCursor, encodeCursor } from "@/server/http/cursor";
import { agencySeesContact, toAgencyBookingDTO, toAgencyBookingListItem } from "@/server/views/agency";
import { agencyIdOf } from "./shared";

async function tripsById(ids: readonly string[]): Promise<Map<string, TripDoc>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const docs = await getDocStore().getMany<TripDoc>(C.trips, unique);
  return new Map(docs.filter((t): t is TripDoc => !!t).map((t) => [t.id, t]));
}

export async function bookingCounts(agencyId: string): Promise<Record<AgencyBookingTab, number>> {
  const store = getDocStore();
  const entries = await Promise.all(
    AGENCY_BOOKING_TABS.map(async (tab) => [tab, await store.count(C.bookings, { where: [["agencyId", "==", agencyId], ["status", "in", [...AGENCY_TAB_STATUSES[tab]]]] })] as const),
  );
  return Object.fromEntries(entries) as Record<AgencyBookingTab, number>;
}

export async function listBookings(
  session: SessionContext,
  q: { tab: AgencyBookingTab; tripId?: string; cursor?: string; limit: number },
  now: Date,
): Promise<BookingListResponse> {
  const agencyId = agencyIdOf(session);
  const store = getDocStore();
  let rows: BookingDoc[];
  if (q.tripId) {
    // Small per-trip list (≤ ~50 bookings): filter the tab in memory.
    const all = await store.query<BookingDoc>(C.bookings, {
      where: [["agencyId", "==", agencyId], ["tripId", "==", q.tripId]],
      orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
      limit: 200,
    });
    const filtered = all.filter((b) => AGENCY_TAB_STATUSES[q.tab].includes(b.status));
    const start = q.cursor ? Number(decodeCursor(q.cursor)?.[0] ?? 0) : 0;
    rows = filtered.slice(start, start + q.limit + 1);
    const items = rows.slice(0, q.limit);
    const trips = await tripsById(items.map((b) => b.tripId));
    return {
      items: items.map((b) => toAgencyBookingListItem(b, trips, now)),
      nextCursor: rows.length > q.limit ? encodeCursor([start + q.limit]) : null,
      counts: await bookingCounts(agencyId),
    };
  }
  rows = await store.query<BookingDoc>(C.bookings, {
    where: [["agencyId", "==", agencyId], ["status", "in", [...AGENCY_TAB_STATUSES[q.tab]]]],
    orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  const trips = q.tab === "pending" ? await tripsById(items.map((b) => b.tripId)) : new Map<string, TripDoc>();
  return {
    items: items.map((b) => toAgencyBookingListItem(b, trips, now)),
    nextCursor: rows.length > q.limit && last ? encodeCursor([last.createdAt, last.id]) : null,
    counts: await bookingCounts(agencyId),
  };
}

export async function getBooking(session: SessionContext, bookingId: string, now: Date): Promise<AgencyBookingDTO> {
  const agencyId = agencyIdOf(session);
  const store = getDocStore();
  const b = await store.get<BookingDoc>(C.bookings, bookingId);
  if (!b || b.agencyId !== agencyId) throw new DomainError("not_found");
  const [shipment, trip, customer, payments, events] = await Promise.all([
    store.get<ShipmentDoc>(C.shipments, b.shipmentId),
    store.get<TripDoc>(C.trips, b.tripId),
    agencySeesContact(b.status) ? store.get<CustomerDoc>(C.customers, b.customerId) : Promise.resolve(null),
    store.query<PaymentDoc>(C.payments, { where: [["bookingId", "==", bookingId]], limit: 20 }),
    store.query<BookingEventDoc>(sub.bookingEvents(bookingId), { orderBy: [["at", "asc"]], limit: 200 }),
  ]);
  return toAgencyBookingDTO({ booking: b, shipment, trip, customer, payments, events, now });
}

async function assertOwned(agencyId: string, bookingId: string): Promise<void> {
  const b = await getDocStore().get<BookingDoc>(C.bookings, bookingId);
  if (!b || b.agencyId !== agencyId) throw new DomainError("not_found");
}

export async function acceptBooking(session: SessionContext, bookingId: string, now: Date): Promise<AgencyBookingDTO> {
  await assertOwned(agencyIdOf(session), bookingId);
  await coreBookings.accept({ now, actor: session } as Parameters<typeof coreBookings.accept>[0], bookingId);
  return getBooking(session, bookingId, now);
}

export async function rejectBooking(session: SessionContext, bookingId: string, reason: string, now: Date): Promise<AgencyBookingDTO> {
  await assertOwned(agencyIdOf(session), bookingId);
  await coreBookings.reject({ now, actor: session } as Parameters<typeof coreBookings.reject>[0], bookingId, reason);
  return getBooking(session, bookingId, now);
}
