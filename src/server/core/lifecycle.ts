import "server-only";
/**
 * Shared pieces of the booking lifecycle used by bookings, payments, trips and the sweep:
 *  - `readBundle`: the documents every booking transaction needs (read phase);
 *  - lazy expiry (P2 §5.1): `dueExpiry` + `applyExpiry` run first in every transaction
 *    that loads a booking, so no stale request or unpaid hold is ever acted on;
 *  - role-specific notification copy.
 */
import { PAYABLE_STATUSES } from "@/lib/domain/booking-machine";
import { V2 } from "@/lib/domain/constants";
import type { Actor, NotificationKind, Role } from "@/lib/domain/model";
import { C } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { AgencyDoc, BookingDoc, PaymentDoc, ShipmentDoc, TripDoc } from "../db/schema";
import { closeBooking, readPayments, type CloseOutcome } from "./internal";
import { notifyMany, type NotifyInput } from "./notify";

export interface BookingBundle {
  booking: BookingDoc;
  trip: TripDoc | null;
  shipment: ShipmentDoc | null;
  agency: AgencyDoc | null;
  payments: PaymentDoc[];
}

/** Read phase for a booking command. Null when the booking doesn't exist. */
export async function readBundle(tx: TxContext, bookingId: string): Promise<BookingBundle | null> {
  const booking = await tx.get<BookingDoc>(C.bookings, bookingId);
  if (!booking) return null;
  const [trip, shipment, agency] = await Promise.all([
    tx.get<TripDoc>(C.trips, booking.tripId),
    tx.get<ShipmentDoc>(C.shipments, booking.shipmentId),
    tx.get<AgencyDoc>(C.agencies, booking.agencyId),
  ]);
  const payments = await readPayments(tx, bookingId);
  return { booking, trip, shipment, agency, payments };
}

export type ExpiryKind = "expireRequest" | "expirePayment";

const ms = (iso: string) => Date.parse(iso);

/** Which expiry (if any) is due for this booking right now. Pure. */
export function dueExpiry(b: BookingDoc, trip: TripDoc | null, payments: readonly PaymentDoc[], now: Date): ExpiryKind | null {
  const t = now.getTime();
  if (b.status === "awaiting_agency") return t >= ms(b.respondBy) ? "expireRequest" : null;
  if (!PAYABLE_STATUSES.includes(b.status)) return null;
  const hold = trip?.holds[b.id];
  if (hold?.kind === "paid") return null;
  const dueAt = hold?.dueAt ?? b.paymentDueAt;
  if (!dueAt || t < ms(dueAt)) return null;
  // A checkout started within the grace period may still complete.
  const graceMs = V2.checkoutGraceMinutes * 60_000;
  const recentCheckout = payments.some((p) => p.bookingId === b.id && (p.status === "pending" || p.status === "created") && t - ms(p.createdAt) < graceMs);
  return recentCheckout ? null : "expirePayment";
}

/** Close a booking because its request or payment window lapsed (queues writes + notifications). */
export function applyExpiry(
  tx: TxContext,
  bundle: BookingBundle,
  kind: ExpiryKind,
  now: Date,
  opts: { by?: Actor; deferTrip?: boolean } = {},
): CloseOutcome | null {
  const by: Actor = opts.by ?? { role: "system", userId: null };
  const out = closeBooking(tx, {
    deferTrip: opts.deferTrip,
    booking: bundle.booking,
    trip: bundle.trip,
    shipment: bundle.shipment,
    payments: bundle.payments,
    event: kind,
    by,
    now,
    rejectReason: "no_response_before_departure",
    cancelReason: "payment_window_expired",
    note: kind === "expireRequest" ? "The agency did not respond in time." : "The payment window closed.",
    refundReason: "late_payment",
  });
  if (!out) return null;
  const b = out.booking;
  const list: NotifyInput[] =
    kind === "expireRequest"
      ? [msg.customer(b, "booking_expired", "Request expired", `${b.display.agencyName} didn't respond to ${b.id} in time. Choose another trip for your shipment.`)]
      : [
          msg.customer(b, "booking_cancelled", "Booking cancelled — payment window closed", `${b.id} was released because payment wasn't completed in time.`),
          ...(bundle.agency ? [msg.agency(bundle.agency, b, "booking_cancelled", "Booking released", `${b.id} was released: the customer didn't pay in time.`)] : []),
        ];
  notifyMany(tx, list, now);
  return out;
}

// ── Notification copy ────────────────────────────────────────────────────────
function to(userId: string, role: Role, kind: NotificationKind, title: string, body: string, bookingId: string): NotifyInput {
  return { userId, role, kind, title, body, link: { type: "booking", id: bookingId } };
}

export const msg = {
  customer: (b: Pick<BookingDoc, "id" | "customerId">, kind: NotificationKind, title: string, body: string): NotifyInput => to(b.customerId, "customer", kind, title, body, b.id),
  driver: (b: Pick<BookingDoc, "id" | "driverId">, kind: NotificationKind, title: string, body: string): NotifyInput => to(b.driverId, "driver", kind, title, body, b.id),
  agency: (a: Pick<AgencyDoc, "ownerUserId">, b: Pick<BookingDoc, "id">, kind: NotificationKind, title: string, body: string): NotifyInput =>
    to(a.ownerUserId, "agency", kind, title, body, b.id),
};
