import "server-only";
/**
 * Tracking read model (P2 §5.1 "Tracking stages", §10). Only REAL events: booking status
 * history, driver remarks/proof (bookings/{id}/events) and checkpoint actual times (trip).
 * `liveLocation` is always null — nothing is interpolated or fabricated.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { statusReachedAt } from "@/lib/domain/booking-machine";
import type { BookingStatus, IsoDateTime } from "@/lib/domain/model";
import { getDocStore } from "../db";
import { C, sub } from "../db/collections";
import type { BookingDoc, BookingEventDoc, TripDoc, TripEventDoc } from "../db/schema";

export type TrackingStageKey = "booking" | "confirmation" | "pickup" | "in_transit" | "checkpoint" | "out_for_delivery" | "delivered" | "rejected" | "cancelled";

export interface TrackingStage {
  key: TrackingStageKey;
  label: string;
  state: "done" | "current" | "upcoming" | "skipped";
  /** Actual time (null = not reached). For checkpoints: arrival (or departure) time. */
  at: IsoDateTime | null;
  /** Checkpoint rows only. */
  checkpointIndex: number | null;
  placeName: string | null;
  expectedAt: IsoDateTime | null;
  departedAt: IsoDateTime | null;
  note: string | null;
}

export interface TrackingReadModel {
  booking: BookingDoc;
  trip: TripDoc;
  status: BookingStatus;
  stages: TrackingStage[];
  events: BookingEventDoc[];
  tripEvents: TripEventDoc[];
  proofFileIds: string[];
  liveLocation: null;
}

const REJECT_NOTES: Record<string, string> = {
  agency_rejected: "Declined by the agency",
  no_response_before_departure: "The agency didn't respond in time",
  trip_cancelled: "The trip was cancelled",
};
const CANCEL_NOTES: Record<string, string> = {
  customer_cancelled: "Cancelled by you",
  payment_window_expired: "Payment window closed",
  trip_cancelled: "The trip was cancelled",
  pickup_refused: "The driver refused pickup",
};

function row(key: TrackingStageKey, label: string, at: IsoDateTime | null, extra: Partial<TrackingStage> = {}): TrackingStage {
  return { key, label, state: at ? "done" : "upcoming", at, checkpointIndex: null, placeName: null, expectedAt: null, departedAt: null, note: null, ...extra };
}

/** Pure: stages for a booking given its trip and booking events. */
export function trackingStages(booking: BookingDoc, trip: TripDoc, events: readonly BookingEventDoc[]): TrackingStage[] {
  const reached = (s: BookingStatus) => statusReachedAt(booking, s);
  const lastOf = (type: BookingEventDoc["type"]) => [...events].reverse().find((e) => e.type === type) ?? null;
  const acceptedAt = booking.acceptedAt ?? reached("pending_payment");
  const deliveredEv = lastOf("delivered");

  const stages: TrackingStage[] = [
    row("booking", "Booking requested", booking.createdAt, { note: `Sent to ${booking.display.agencyName}` }),
    row("confirmation", "Confirmation", booking.paidAt, {
      note: acceptedAt ? (booking.paidAt ? "Accepted and paid" : "Accepted — awaiting payment") : "Waiting for the agency",
      expectedAt: booking.paidAt ? null : booking.paymentDueAt ?? booking.respondBy,
    }),
    row("pickup", "Picked up", reached("picked_up"), { placeName: booking.pickup.placeName, expectedAt: booking.pickup.expectedDepartureAt, checkpointIndex: booking.pickup.checkpointIndex }),
    row("in_transit", "In transit", reached("in_transit")),
  ];
  for (const cp of trip.checkpoints) {
    if (cp.index <= booking.pickup.checkpointIndex || cp.index >= booking.drop.checkpointIndex) continue;
    stages.push(
      row("checkpoint", cp.placeName, cp.actualArrivalAt, {
        checkpointIndex: cp.index,
        placeName: cp.placeName,
        expectedAt: cp.expectedArrivalAt,
        departedAt: cp.actualDepartureAt,
      }),
    );
  }
  stages.push(
    row("out_for_delivery", "Out for delivery", reached("out_for_delivery"), { placeName: booking.drop.placeName, expectedAt: booking.drop.expectedArrivalAt, checkpointIndex: booking.drop.checkpointIndex }),
    row("delivered", "Delivered", reached("delivered"), { placeName: booking.drop.placeName, note: deliveredEv?.remarks ?? null }),
  );

  const closed = booking.status === "rejected" || booking.status === "cancelled";
  // Checkpoints the trip passed while the goods were on board are done even if the booking
  // status hasn't changed; everything before the furthest done stage is treated as done/skipped.
  let lastDone = -1;
  stages.forEach((s, i) => {
    if (s.state === "done") lastDone = i;
  });
  stages.forEach((s, i) => {
    if (s.state === "done") return;
    if (closed) s.state = "skipped";
    else if (i < lastDone) s.state = "skipped";
    else if (i === lastDone + 1) s.state = "current";
  });
  if (booking.status === "rejected") {
    stages.push(row("rejected", "Request declined", booking.rejection?.at ?? reached("rejected"), { note: booking.rejection ? (REJECT_NOTES[booking.rejection.reason] ?? "Declined") + (booking.rejection.note ? `: ${booking.rejection.note}` : "") : null }));
  } else if (booking.status === "cancelled") {
    stages.push(row("cancelled", "Cancelled", booking.cancellation?.at ?? reached("cancelled"), { note: booking.cancellation ? (CANCEL_NOTES[booking.cancellation.reason] ?? "Cancelled") + (booking.cancellation.note ? `: ${booking.cancellation.note}` : "") : null }));
  }
  return stages;
}

/** Loads booking, trip and events (no authorisation — callers check ownership first). */
export async function loadTracking(bookingId: string): Promise<TrackingReadModel> {
  const store = getDocStore();
  const booking = await store.get<BookingDoc>(C.bookings, bookingId);
  if (!booking) throw new DomainError("not_found");
  const [trip, events, tripEvents] = await Promise.all([
    store.get<TripDoc>(C.trips, booking.tripId),
    store.query<BookingEventDoc>(sub.bookingEvents(bookingId), { orderBy: [["at", "asc"]] }),
    store.query<TripEventDoc>(sub.tripEvents(booking.tripId), { orderBy: [["at", "asc"]] }),
  ]);
  if (!trip) throw new DomainError("not_found");
  const proofFileIds = events.filter((e) => e.type === "delivered" || e.type === "delivery_proof_added").flatMap((e) => e.files.map((f) => f.fileId));
  return { booking, trip, status: booking.status, stages: trackingStages(booking, trip, events), events, tripEvents, proofFileIds, liveLocation: null };
}
