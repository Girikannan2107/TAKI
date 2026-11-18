import "server-only";
/**
 * Customer bookings (P2 §8.4, D3): read side + thin delegates to D5 `core.bookings.*`
 * for every state change (request, cancel, review, OTP regeneration).
 */
import type { Page, ReviewDTO } from "@/lib/api/contracts/common";
import type { CustomerBookingDTO, CustomerBookingListItem, TrackingDTO } from "@/lib/api/contracts/customer";
import { DomainError } from "@/lib/api/contracts/errors";
import type { CustomerTab } from "@/lib/domain/model";
import type { SessionContext } from "../../auth/guards";
import { bookings as coreBookings } from "../../core/bookings";
import { trackingStages } from "../../core/tracking";
import { C, sub } from "../../db/collections";
import { getDocStore } from "../../db";
import type { AgencyDoc, BookingDoc, BookingEventDoc, BookingSecretsDoc, DriverDoc, PaymentDoc, ReviewDoc, ShipmentDoc, TripDoc } from "../../db/schema";
import { decodeCursor, pageOf } from "../../http/cursor";
import { toBookingListItem, toCustomerBookingView, toCustomerReview, toTrackingDTO } from "../../views/customer";

/** Same 404 for "missing" and "someone else's" (no existence leak). */
export function assertOwnBooking(session: SessionContext, b: BookingDoc | null): asserts b is BookingDoc {
  if (!b || session.role !== "customer" || b.customerId !== session.userId) throw new DomainError("not_found");
}

export async function getOwnBookingDoc(session: SessionContext, bookingId: string): Promise<BookingDoc> {
  const b = await getDocStore().get<BookingDoc>(C.bookings, bookingId);
  assertOwnBooking(session, b);
  return b;
}

const OTP_STATUSES = new Set(["confirmed", "picked_up", "in_transit", "out_for_delivery"]);

/** The payment to show for a booking: the one that paid it, else the newest attempt. */
async function bookingPayment(b: BookingDoc): Promise<PaymentDoc | null> {
  const store = getDocStore();
  if (b.paymentId) {
    const p = await store.get<PaymentDoc>(C.payments, b.paymentId);
    if (p) return p;
  }
  const rows = await store.query<PaymentDoc>(C.payments, {
    where: [["bookingId", "==", b.id]],
    orderBy: [["createdAt", "desc"]],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Full customer view of an owned booking. */
export async function loadBookingView(session: SessionContext, bookingOrId: BookingDoc | string, now: Date): Promise<CustomerBookingDTO> {
  const store = getDocStore();
  const booking = typeof bookingOrId === "string" ? await getOwnBookingDoc(session, bookingOrId) : bookingOrId;
  assertOwnBooking(session, booking);
  const [shipment, trip, agency, driver, payment, secrets, review] = await Promise.all([
    store.get<ShipmentDoc>(C.shipments, booking.shipmentId),
    store.get<TripDoc>(C.trips, booking.tripId),
    store.get<AgencyDoc>(C.agencies, booking.agencyId),
    store.get<DriverDoc>(C.drivers, booking.driverId),
    bookingPayment(booking),
    OTP_STATUSES.has(booking.status) ? store.get<BookingSecretsDoc>(C.bookingSecrets, booking.id) : Promise.resolve(null),
    booking.reviewed ? store.get<ReviewDoc>(C.reviews, booking.id) : Promise.resolve(null),
  ]);
  if (!shipment || !trip) throw new DomainError("not_found");
  return toCustomerBookingView({ booking, shipment, trip, agency, driver, payment, secrets, review, now });
}

/** POST /api/customer/bookings — delegates to core (idempotent; one open booking per shipment). */
export async function requestBooking(
  session: SessionContext,
  i: { shipmentId: string; tripId: string; idempotencyKey: string },
  now: Date,
): Promise<{ booking: CustomerBookingDTO; replayed: boolean }> {
  const { booking, replayed } = await coreBookings.request({ now, actor: session }, i);
  return { booking: await loadBookingView(session, booking, now), replayed };
}

export async function listBookings(
  session: SessionContext,
  q: { tab?: CustomerTab; active?: boolean; cursor?: string; limit: number },
): Promise<Page<CustomerBookingListItem>> {
  const store = getDocStore();
  const where: Array<readonly [string, "==" | "in", unknown]> = [["customerId", "==", session.userId]];
  if (q.tab) where.push(["tab", "==", q.tab]);
  else if (q.active) where.push(["tab", "in", ["pending", "confirmed", "picked_up", "in_transit"]]);
  const rows = await store.query<BookingDoc>(C.bookings, {
    where,
    orderBy: [
      ["updatedAt", "desc"],
      ["__name__", "desc"],
    ],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const page = pageOf(rows, q.limit, (b) => [b.updatedAt, b.id]);
  const tripIds = [...new Set(page.items.map((b) => b.tripId))];
  const trips = tripIds.length ? await store.getMany<TripDoc>(C.trips, tripIds) : [];
  const byId = new Map(trips.filter((t): t is TripDoc => !!t).map((t) => [t.id, t]));
  return { items: page.items.map((b) => toBookingListItem(b, byId.get(b.tripId))), nextCursor: page.nextCursor };
}

/** Counts per customer tab (7 aggregate counts; equality-only, no composite index needed). */
export async function tabCounts(session: SessionContext): Promise<Record<CustomerTab, number>> {
  const store = getDocStore();
  const tabs: CustomerTab[] = ["pending", "confirmed", "picked_up", "in_transit", "delivered", "rejected", "cancelled"];
  const counts = await Promise.all(
    tabs.map((tab) =>
      store.count(C.bookings, {
        where: [
          ["customerId", "==", session.userId],
          ["tab", "==", tab],
        ],
      }),
    ),
  );
  return Object.fromEntries(tabs.map((t, i) => [t, counts[i]!])) as Record<CustomerTab, number>;
}

export async function cancelBooking(session: SessionContext, bookingId: string, reason: string | undefined, now: Date): Promise<CustomerBookingDTO> {
  await getOwnBookingDoc(session, bookingId);
  const b = await coreBookings.cancelByCustomer({ now, actor: session }, bookingId, reason || undefined);
  return loadBookingView(session, b, now);
}

export async function regenerateOtp(session: SessionContext, bookingId: string, which: "pickup" | "delivery", now: Date): Promise<{ otps: CustomerBookingDTO["otps"] }> {
  await getOwnBookingDoc(session, bookingId);
  await coreBookings.regenerateOtp({ now, actor: session }, bookingId, which);
  const view = await loadBookingView(session, bookingId, now);
  return { otps: view.otps };
}

export async function reviewBooking(session: SessionContext, bookingId: string, i: { rating: number; comment?: string }, now: Date): Promise<ReviewDTO> {
  await getOwnBookingDoc(session, bookingId);
  const r = await coreBookings.review({ now, actor: session }, bookingId, { rating: i.rating, ...(i.comment ? { comment: i.comment } : {}) });
  return toCustomerReview(r);
}

/** GET /api/customer/bookings/[id]/tracking — only real events (no GPS, nothing simulated). */
export async function bookingTracking(session: SessionContext, bookingId: string): Promise<TrackingDTO> {
  const store = getDocStore();
  const booking = await getOwnBookingDoc(session, bookingId);
  const [trip, events] = await Promise.all([
    store.get<TripDoc>(C.trips, booking.tripId),
    store.query<BookingEventDoc>(sub.bookingEvents(booking.id), { orderBy: [["at", "asc"]], limit: 200 }),
  ]);
  if (!trip) throw new DomainError("not_found");
  return toTrackingDTO(booking, trackingStages(booking, trip, events), events);
}
