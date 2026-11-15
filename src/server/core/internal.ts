import "server-only";
/**
 * Shared building blocks for core commands. Transactions here follow one pattern:
 * read everything → decide (pure) → queue writes. A command that must persist something
 * AND report an error (wrong OTP attempt counter, lazy expiry) returns `fail(error)` from
 * the transaction; `txn()` throws it after the commit.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { applyEvent, type BookingEventV2 } from "@/lib/domain/booking-machine";
import { newId } from "@/lib/domain/ids";
import type { Actor, BookingStatus, CancelReason, FileRef, RejectReason, TrackingEventType } from "@/lib/domain/model";
import type { SessionContext } from "./context";
import { C, sub } from "../db/collections";
import type { TxContext } from "../db/docstore";
import { getDocStore } from "../db";
import type { BookingDoc, BookingEventDoc, PaymentDoc, ShipmentDoc, TripDoc } from "../db/schema";
import { enqueueJob } from "./jobs";

export class Failure {
  constructor(readonly error: DomainError) {}
}

export function fail(code: ConstructorParameters<typeof DomainError>[0], message?: string, extra?: ConstructorParameters<typeof DomainError>[2]): Failure {
  return new Failure(new DomainError(code, message, extra));
}

/** Run a transaction; a returned Failure is committed first, then thrown. */
export async function txn<T>(fn: (tx: TxContext) => Promise<T | Failure>, maxAttempts = 30): Promise<T> {
  const r = await getDocStore().runTransaction(fn, { maxAttempts });
  if (r instanceof Failure) throw r.error;
  return r;
}

export const iso = (d: Date) => d.toISOString();
export const addMinutes = (d: Date | string, m: number) => new Date((typeof d === "string" ? Date.parse(d) : d.getTime()) + m * 60_000);

export function actorOfSession(s: SessionContext): Actor {
  return { role: s.role, userId: s.userId };
}

// ── Ownership guards (not_found when not visible: no existence leak) ─────────
export function assertCustomerOwns(actor: SessionContext, b: { customerId: string } | null): asserts b {
  if (!b || actor.role !== "customer" || b.customerId !== actor.userId) throw new DomainError("not_found");
}
export function assertAgencyOwns(actor: SessionContext, b: { agencyId: string } | null): asserts b {
  if (!b || actor.role !== "agency" || !actor.agencyId || b.agencyId !== actor.agencyId) throw new DomainError("not_found");
}
export function assertDriverAssigned(actor: SessionContext, b: { driverId: string } | null): asserts b {
  if (!b || actor.role !== "driver" || b.driverId !== actor.userId) throw new DomainError("not_found");
}

// ── Booking writes ───────────────────────────────────────────────────────────
export function bookingEvent(
  bookingId: string,
  type: TrackingEventType,
  now: Date,
  actor: Actor,
  extra: Partial<Pick<BookingEventDoc, "clientAt" | "checkpointIndex" | "placeName" | "remarks" | "files">> = {},
): BookingEventDoc {
  return {
    id: newId("bev"),
    bookingId,
    type,
    at: iso(now),
    clientAt: extra.clientAt ?? null,
    actor,
    checkpointIndex: extra.checkpointIndex ?? null,
    placeName: extra.placeName ?? null,
    remarks: extra.remarks ?? null,
    files: extra.files ?? ([] as FileRef[]),
  };
}

export function writeEvent(tx: TxContext, ev: BookingEventDoc): void {
  tx.create(sub.bookingEvents(ev.bookingId), ev.id, ev);
}

/** applyEvent + bump version; returns null when the event is a no-op (already there). */
export function transition(b: BookingDoc, event: BookingEventV2, now: Date, by: Actor, note?: string): BookingDoc | null {
  const r = applyEvent(b, event, { at: iso(now), by, note });
  return r.changed ? r.booking : null;
}

export interface CloseOutcome {
  booking: BookingDoc;
  trip: TripDoc | null;
  shipment: ShipmentDoc | null;
  refundJobIds: string[];
}

/**
 * Close a booking (reject / cancel / expire) and compute every dependent change:
 *  - removes its capacity hold and fixes trip counters;
 *  - reopens the shipment (customer can choose another trip);
 *  - succeeded payment → refund_pending + refund job; open payments → cancelled.
 * Caller has already READ booking, trip, shipment and payments; this only queues writes.
 */
export function closeBooking(
  tx: TxContext,
  i: {
    booking: BookingDoc;
    trip: TripDoc | null;
    shipment: ShipmentDoc | null;
    payments: readonly PaymentDoc[];
    event: Extract<BookingEventV2, "reject" | "expireRequest" | "cancel" | "expirePayment" | "tripCancelled" | "refusePickup">;
    by: Actor;
    now: Date;
    rejectReason?: RejectReason;
    cancelReason?: CancelReason;
    note?: string | null;
    refundReason?: string;
    /** Don't write the trip (caller batches several closes on one trip and writes it once). */
    deferTrip?: boolean;
  },
): CloseOutcome | null {
  const { booking, now } = i;
  const prev: BookingStatus = booking.status;
  const next = transition(booking, i.event, now, i.by, i.note ?? undefined);
  if (!next) return null;
  const at = iso(now);
  if (next.status === "rejected") next.rejection = { reason: i.rejectReason ?? "agency_rejected", note: i.note ?? null, at };
  if (next.status === "cancelled") next.cancellation = { reason: i.cancelReason ?? "customer_cancelled", note: i.note ?? null, at, by: i.by };

  let trip = i.trip;
  if (trip) {
    const holds = { ...trip.holds };
    const hadHold = Boolean(holds[booking.id]);
    delete holds[booking.id];
    trip = {
      ...trip,
      holds,
      counts: {
        ...trip.counts,
        awaiting: Math.max(0, trip.counts.awaiting - (prev === "awaiting_agency" ? 1 : 0)),
        held: Math.max(0, trip.counts.held - (hadHold ? 1 : 0)),
      },
      updatedAt: at,
      version: trip.version + 1,
    };
  }

  let shipment = i.shipment;
  if (shipment && shipment.currentBookingId === booking.id) {
    shipment = { ...shipment, currentBookingId: null, status: "open", updatedAt: at };
  }

  const refundJobIds: string[] = [];
  for (const p of i.payments) {
    if (p.bookingId !== booking.id) continue;
    if (p.status === "succeeded") {
      const refundId = `rf_${p.id}`;
      const updated: PaymentDoc = {
        ...p,
        status: "refund_pending",
        refund: { refundId, amountPaise: p.amountPaise, reason: i.refundReason ?? i.cancelReason ?? "cancelled", status: "pending", requestedAt: at, completedAt: null, providerRefundId: null },
        updatedAt: at,
        version: p.version + 1,
      };
      tx.set(C.payments, p.id, updated);
      refundJobIds.push(enqueueJob(tx, "refund", { paymentId: p.id, refundId, amountPaise: p.amountPaise, reason: updated.refund!.reason }, now).id);
    } else if (p.status === "created" || p.status === "pending") {
      tx.set(C.payments, p.id, { ...p, status: "cancelled", failureReason: "booking_closed", updatedAt: at, version: p.version + 1 });
    }
  }

  tx.set(C.bookings, next.id, next);
  if (trip && !i.deferTrip) tx.set(C.trips, trip.id, trip);
  if (shipment && shipment !== i.shipment) tx.set(C.shipments, shipment.id, shipment);
  const evType: TrackingEventType = next.status === "rejected" ? "rejected" : "cancelled";
  writeEvent(tx, bookingEvent(booking.id, evType, now, i.by, { remarks: i.note ?? null }));
  return { booking: next, trip, shipment, refundJobIds };
}

/** Payments of a booking (read inside the transaction). */
export async function readPayments(tx: TxContext, bookingId: string): Promise<PaymentDoc[]> {
  return tx.query<PaymentDoc>(C.payments, { where: [["bookingId", "==", bookingId]] });
}
