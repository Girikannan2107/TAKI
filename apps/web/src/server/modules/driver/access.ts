import "server-only";
/** Shared guards for the driver module (D4). */
import { DomainError } from "@/lib/api/contracts/errors";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { BookingDoc, DriverDoc, TripDoc } from "@/server/db/schema";
import { isVisibleToDriver } from "@/server/views/driver";

export async function loadDriver(session: SessionContext): Promise<DriverDoc> {
  if (session.role !== "driver") throw new DomainError("forbidden");
  const d = await getDocStore().get<DriverDoc>(C.drivers, session.userId);
  if (!d) throw new DomainError("not_found", "Your driver profile could not be found.");
  return d;
}

export function isApproved(d: DriverDoc): boolean {
  return d.agencyLink?.status === "active";
}

/** Trips and shipment actions need an ACTIVE agency link (agency approved the driver). */
export async function requireLinkedDriver(session: SessionContext): Promise<DriverDoc> {
  const d = await loadDriver(session);
  if (!isApproved(d)) throw new DomainError("driver_not_linked");
  return d;
}

/** Booking assigned to this driver (confirmed or later). Missing and foreign bookings are both 404. */
export async function loadVisibleBooking(session: SessionContext, bookingId: string): Promise<BookingDoc> {
  const b = await getDocStore().get<BookingDoc>(C.bookings, bookingId);
  if (!b || !isVisibleToDriver(b, session.userId)) throw new DomainError("not_found");
  return b;
}

/** Trip assigned to this driver (never a draft). Missing and foreign trips are both 404. */
export async function loadAssignedTrip(session: SessionContext, tripId: string): Promise<TripDoc> {
  const t = await getDocStore().get<TripDoc>(C.trips, tripId);
  if (!t || t.driverId !== session.userId || t.status === "draft") throw new DomainError("not_found");
  return t;
}

export function ctxOf(session: SessionContext, now: Date) {
  return { now, actor: session };
}
