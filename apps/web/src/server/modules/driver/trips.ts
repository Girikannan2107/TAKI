import "server-only";
/**
 * Driver trips (P2 §8.6): list, trip-run view, checkpoint arrive/depart and complete.
 * Checkpoint events and completion go through D5 `core.tripsLifecycle`, which timestamps them
 * on the server and fans out the automatic booking transitions that feed customer tracking.
 */
import type { DriverTripDTO, DriverTripFilter, DriverTripListItem } from "@/lib/api/contracts/driver";
import { DRIVER_VISIBLE_STATUSES } from "@/lib/domain/booking-machine";
import type { TripStatus } from "@/lib/domain/model";
import type { SessionContext } from "@/server/auth/guards";
import { tripsLifecycle } from "@/server/core";
import { C, getDocStore, sub } from "@/server/db";
import type { BookingDoc, TripDoc, TripEventDoc } from "@/server/db/schema";
import { toDriverTripListItem, toDriverTripView } from "@/server/views/driver";
import { ctxOf, loadAssignedTrip, requireLinkedDriver } from "./access";
import { shipmentsFor } from "./shipments";

const FILTER_STATUS: Record<DriverTripFilter, TripStatus> = {
  upcoming: "published",
  active: "in_progress",
  completed: "completed",
};

export async function queryDriverTrips(driverId: string, status: TripStatus, dir: "asc" | "desc", limit: number): Promise<TripDoc[]> {
  return getDocStore().query<TripDoc>(C.trips, {
    where: [
      ["driverId", "==", driverId],
      ["status", "==", status],
    ],
    orderBy: [["departureAt", dir]],
    limit,
  });
}

export async function listTrips(session: SessionContext, filter: DriverTripFilter): Promise<{ items: DriverTripListItem[] }> {
  await requireLinkedDriver(session);
  const rows = await queryDriverTrips(session.userId, FILTER_STATUS[filter], filter === "completed" ? "desc" : "asc", 50);
  return { items: rows.map(toDriverTripListItem) };
}

async function viewOf(session: SessionContext, trip: TripDoc): Promise<DriverTripDTO> {
  const store = getDocStore();
  const [bookings, events] = await Promise.all([
    store.query<BookingDoc>(C.bookings, {
      where: [
        ["tripId", "==", trip.id],
        ["status", "in", DRIVER_VISIBLE_STATUSES],
      ],
      limit: 100,
    }),
    store.query<TripEventDoc>(sub.tripEvents(trip.id), { orderBy: [["at", "asc"]], limit: 200 }),
  ]);
  const shipments = await shipmentsFor(bookings);
  return toDriverTripView(trip, bookings, shipments, events, session.userId);
}

export async function getTrip(session: SessionContext, tripId: string): Promise<DriverTripDTO> {
  await requireLinkedDriver(session);
  const trip = await loadAssignedTrip(session, tripId);
  return viewOf(session, trip);
}

export async function recordCheckpoint(
  session: SessionContext,
  tripId: string,
  index: number,
  kind: "arrive" | "depart",
  body: { remarks?: string; clientAt?: string },
  now: Date,
): Promise<DriverTripDTO> {
  await requireLinkedDriver(session);
  await loadAssignedTrip(session, tripId);
  const trip = await tripsLifecycle.checkpoint(ctxOf(session, now), tripId, index, kind, { remarks: body.remarks || undefined, clientAt: body.clientAt });
  return viewOf(session, trip);
}

export async function completeTrip(session: SessionContext, tripId: string, now: Date): Promise<DriverTripDTO> {
  await requireLinkedDriver(session);
  await loadAssignedTrip(session, tripId);
  const trip = await tripsLifecycle.complete(ctxOf(session, now), tripId);
  return viewOf(session, trip);
}
