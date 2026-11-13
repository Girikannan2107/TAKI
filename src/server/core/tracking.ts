import "server-only";
/**
 * Tracking read model (P2 §5.1 "Tracking stages", §10). Only REAL events: booking status
 * history, driver remarks/proof (bookings/{id}/events) and checkpoint actual times (trip).
 * `liveLocation` is always null — nothing is interpolated or fabricated.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { BookingStatus, IsoDateTime } from "@/lib/domain/model";
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

/** Pure: stages for a booking given its trip and booking events. */
export function trackingStages(_booking: BookingDoc, _trip: TripDoc, _events: readonly BookingEventDoc[]): TrackingStage[] {
  throw new DomainError("not_implemented");
}

/** Loads booking, trip and events (no authorisation — callers check ownership first). */
export async function loadTracking(_bookingId: string): Promise<TrackingReadModel> {
  throw new DomainError("not_implemented");
}
