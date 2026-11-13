import "server-only";
/**
 * Trip lifecycle commands (P2 §5.2, §6.4). D2 owns trip drafts (create/update in
 * modules/agency/trips.ts); everything that touches schedules, capacity or bookings is here.
 *
 * Driver and vehicle schedule locks: publish and reassign read `schedules/driver:{id}` and
 * `schedules/vehicle:{id}` inside the transaction, which serialises concurrent publishes for
 * the same driver or vehicle; overlapping intervals fail with 409 *_schedule_conflict.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { OPEN_STATUSES, PICKED_UP_OR_LATER } from "@/lib/domain/booking-machine";
import { V2 } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import type { Actor, Id, IsoDateTime, TripEventType } from "@/lib/domain/model";
import { pickupKeysFor } from "@/lib/domain/segments";
import { C, scheduleId, sub } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { AgencyDoc, BookingDoc, DriverDoc, PaymentDoc, ScheduleDoc, ShipmentDoc, TripDoc, TripEventDoc, UserDoc, VehicleDoc } from "../db/schema";
import type { Ctx } from "./context";
import { actorOfSession, assertAgencyOwns, assertDriverAssigned, bookingEvent, closeBooking, iso, transition, txn, writeEvent } from "./internal";
import { runJobsAfterCommit } from "./jobs";
import { applyExpiry, dueExpiry, msg, type BookingBundle } from "./lifecycle";
import { notifyMany, type NotifyInput } from "./notify";
import { findConflict, intervalForTrip, withInterval, withoutTrip } from "./schedules";

// ── helpers ──────────────────────────────────────────────────────────────────


function requireRole(ctx: Ctx, role: "agency" | "driver"): void {
  if (ctx.actor.role !== role) throw new DomainError("forbidden");
}

const t = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** Publish-time validation of checkpoints, times and capacity (P2 §5.2). Throws DomainError. */
export function validateTripForPublish(trip: TripDoc, vehicle: VehicleDoc, now: Date): void {
  const cps = trip.checkpoints;
  const bad = (message: string): never => {
    throw new DomainError("invalid_checkpoints", message);
  };
  if (cps.length < V2.minCheckpoints || cps.length > V2.maxCheckpoints) bad(`A trip needs ${V2.minCheckpoints}–${V2.maxCheckpoints} checkpoints.`);
  cps.forEach((c, i) => {
    if (c.index !== i) bad("Checkpoints are out of order.");
    if (i === 0 && c.kmFromOrigin !== 0) bad("The first checkpoint must be the origin (0 km).");
    if (i > 0 && !(c.kmFromOrigin > cps[i - 1]!.kmFromOrigin)) bad("Each checkpoint must be further along the route than the previous one.");
    const last = i === cps.length - 1;
    if (!last && !c.expectedDepartureAt) bad(`Add a departure time for ${c.placeName}.`);
    if (i > 0 && !c.expectedArrivalAt) bad(`Add an arrival time for ${c.placeName}.`);
    if (c.expectedArrivalAt && c.expectedDepartureAt && t(c.expectedDepartureAt) < t(c.expectedArrivalAt)) bad(`Departure from ${c.placeName} must be after arrival.`);
    if (i > 0) {
      const prevDep = t(cps[i - 1]!.expectedDepartureAt);
      if (!(t(c.expectedArrivalAt) > prevDep)) bad(`Arrival at ${c.placeName} must be after leaving ${cps[i - 1]!.placeName}.`);
    }
  });
  if (t(trip.departureAt) !== t(cps[0]!.expectedDepartureAt) || t(trip.arrivalAt) !== t(cps[cps.length - 1]!.expectedArrivalAt))
    bad("Trip departure and arrival must match the first and last checkpoints.");
  const lead = t(trip.departureAt) - now.getTime();
  if (lead < V2.publishMinLeadMinutes * 60_000) throw new DomainError("invalid_checkpoints", `Departure must be at least ${V2.publishMinLeadMinutes} minutes from now.`);
  if (lead > V2.publishMaxDaysAhead * 86_400_000) throw new DomainError("date_too_far");
  if (trip.capacity.offeredKg > vehicle.maxPayloadKg) throw new DomainError("capacity_exceeds_vehicle");
  if (trip.capacity.offeredKg < 100) throw new DomainError("invalid_request", "Offer at least 100 kg.", { fields: { offeredKg: "Minimum 100 kg" } });
}

function tripEvent(tripId: string, type: TripEventType, now: Date, actor: Actor, extra: { checkpointIndex?: number | null; remarks?: string | null; clientAt?: IsoDateTime | null } = {}): TripEventDoc {
  return { id: newId("tev"), tripId, type, checkpointIndex: extra.checkpointIndex ?? null, at: iso(now), clientAt: extra.clientAt ?? null, actor, remarks: extra.remarks ?? null };
}

function writeTripEvent(tx: TxContext, ev: TripEventDoc): void {
  tx.create(sub.tripEvents(ev.tripId), ev.id, ev);
}

/** Bookings on the trip that are not terminal. */
async function openBookings(tx: TxContext, tripId: string): Promise<BookingDoc[]> {
  return tx.query<BookingDoc>(C.bookings, { where: [["tripId", "==", tripId], ["status", "in", [...OPEN_STATUSES]]] });
}

/** Shipments + payments for closing several bookings (read phase). */
async function closeDeps(tx: TxContext, bookings: readonly BookingDoc[]): Promise<{ shipments: Map<string, ShipmentDoc>; payments: PaymentDoc[] }> {
  if (bookings.length === 0) return { shipments: new Map(), payments: [] };
  const ships = await tx.getMany<ShipmentDoc>(C.shipments, bookings.map((b) => b.shipmentId));
  const payments: PaymentDoc[] = [];
  const ids = bookings.map((b) => b.id);
  for (let i = 0; i < ids.length; i += 30) payments.push(...(await tx.query<PaymentDoc>(C.payments, { where: [["bookingId", "in", ids.slice(i, i + 30)]] })));
  return { shipments: new Map(ships.filter((s): s is ShipmentDoc => !!s).map((s) => [s.id, s])), payments };
}

function bundleFor(b: BookingDoc, trip: TripDoc, agency: AgencyDoc | null, deps: { shipments: Map<string, ShipmentDoc>; payments: PaymentDoc[] }): BookingBundle {
  return { booking: b, trip, shipment: deps.shipments.get(b.shipmentId) ?? null, agency, payments: deps.payments.filter((p) => p.bookingId === b.id) };
}

function bumped(trip: TripDoc, now: Date, patch: Partial<TripDoc>): TripDoc {
  return { ...trip, ...patch, updatedAt: iso(now), version: trip.version + 1 };
}

/** Expire every due booking on the trip (chained trip state; trip not written). */
function expireDue(
  tx: TxContext,
  trip: TripDoc,
  bookings: BookingDoc[],
  agency: AgencyDoc | null,
  deps: { shipments: Map<string, ShipmentDoc>; payments: PaymentDoc[] },
  now: Date,
  force = false,
): { trip: TripDoc; remaining: BookingDoc[]; jobIds: string[] } {
  let cur = trip;
  const remaining: BookingDoc[] = [];
  const jobIds: string[] = [];
  for (const b of bookings) {
    const bundle = bundleFor(b, cur, agency, deps);
    const kind = dueExpiry(b, cur, bundle.payments, now) ?? (force ? (b.status === "awaiting_agency" ? "expireRequest" : b.status === "pending_payment" || b.status === "payment_failed" ? "expirePayment" : null) : null);
    if (!kind) {
      remaining.push(b);
      continue;
    }
    const out = applyExpiry(tx, bundle, kind, now, { deferTrip: true });
    if (out?.trip) cur = out.trip;
    if (out) jobIds.push(...out.refundJobIds);
  }
  return { trip: cur, remaining, jobIds };
}

// ── commands ─────────────────────────────────────────────────────────────────

export const tripsLifecycle = {
  /** draft → published: agency verified, vehicle active, driver linked+available, schedules free. */
  async publish(ctx: Ctx, tripId: Id): Promise<TripDoc> {
    requireRole(ctx, "agency");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertAgencyOwns(actor, trip);
      const [agency, vehicle, driver, driverUser, dSched, vSched] = await Promise.all([
        tx.get<AgencyDoc>(C.agencies, trip.agencyId),
        tx.get<VehicleDoc>(C.vehicles, trip.vehicleId),
        tx.get<DriverDoc>(C.drivers, trip.driverId),
        tx.get<UserDoc>(C.users, trip.driverId),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(trip.driverId)),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.vehicle(trip.vehicleId)),
      ]);
      if (trip.status === "published") return trip;
      if (trip.status !== "draft") throw new DomainError("invalid_transition", "Only draft trips can be published.");
      if (!agency || agency.verification.status !== "verified") throw new DomainError("agency_not_verified");
      if (!vehicle || vehicle.agencyId !== trip.agencyId || vehicle.status !== "active") throw new DomainError("vehicle_unavailable");
      if (!driver || driver.agencyLink?.agencyId !== trip.agencyId || driver.agencyLink.status !== "active") throw new DomainError("driver_unavailable", "This driver isn't linked to your agency.");
      if (driver.availability !== "available" || !driverUser || driverUser.status !== "active") throw new DomainError("driver_unavailable");
      validateTripForPublish(trip, vehicle, now);

      const iv = intervalForTrip(trip);
      const dc = findConflict(dSched, iv, now);
      if (dc) throw new DomainError("driver_schedule_conflict", undefined, { details: { conflictingTripId: dc.tripId } });
      const vc = findConflict(vSched, iv, now);
      if (vc) throw new DomainError("vehicle_schedule_conflict", undefined, { details: { conflictingTripId: vc.tripId } });

      const at = iso(now);
      tx.set(C.schedules, scheduleId.driver(trip.driverId), withInterval(dSched, "driver", trip.driverId, iv, now));
      tx.set(C.schedules, scheduleId.vehicle(trip.vehicleId), withInterval(vSched, "vehicle", trip.vehicleId, iv, now));
      const next = bumped(trip, now, {
        status: "published",
        publishedAt: at,
        agencyName: agency.agencyName,
        pickupKeys: pickupKeysFor(trip.checkpoints, trip.departureAt),
        capacity: { ...trip.capacity, vehicleMaxKg: vehicle.maxPayloadKg },
        vehicle: {
          vehicleClass: vehicle.vehicleClass,
          makeModel: vehicle.makeModel,
          registrationNumber: vehicle.registrationNumber,
          bodyType: vehicle.bodyType,
          photo: vehicle.photos[0] ?? null,
          imageKey: vehicle.imageKey,
        },
        driver: { fullName: driver.fullName, photo: driver.photo ?? null, ratingAvg: driver.stats.ratingAvg, ratingCount: driver.stats.ratingCount },
      });
      tx.set(C.trips, trip.id, next);
      notifyMany(
        tx,
        [
          {
            userId: trip.driverId,
            role: "driver",
            kind: "trip_published",
            title: "New trip assigned",
            body: `${trip.checkpoints[0]!.placeName} → ${trip.checkpoints[trip.checkpoints.length - 1]!.placeName}, departing ${trip.departureAt}.`,
            link: { type: "trip", id: trip.id },
          },
        ],
        now,
      );
      return next;
    });
  },

  /** published → draft when no awaiting/held bookings. */
  async unpublish(ctx: Ctx, tripId: Id): Promise<TripDoc> {
    requireRole(ctx, "agency");
    const { now, actor } = ctx;
    const r = await txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertAgencyOwns(actor, trip);
      const [dSched, vSched, agency] = await Promise.all([
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(trip.driverId)),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.vehicle(trip.vehicleId)),
        tx.get<AgencyDoc>(C.agencies, trip.agencyId),
      ]);
      const open = await openBookings(tx, trip.id);
      const deps = await closeDeps(tx, open);
      if (trip.status === "draft") return { trip, jobIds: [] as string[] };
      if (trip.status !== "published") throw new DomainError("invalid_transition", "Only published trips can be moved back to draft.");
      const exp = expireDue(tx, trip, open, agency, deps, now);
      if (exp.remaining.length > 0 || Object.keys(exp.trip.holds).length > 0) throw new DomainError("trip_has_bookings");
      tx.set(C.schedules, scheduleId.driver(trip.driverId), withoutTrip(dSched, "driver", trip.driverId, trip.id, now));
      tx.set(C.schedules, scheduleId.vehicle(trip.vehicleId), withoutTrip(vSched, "vehicle", trip.vehicleId, trip.id, now));
      const next = bumped(exp.trip, now, { status: "draft", publishedAt: null, pickupKeys: [] });
      tx.set(C.trips, trip.id, next);
      return { trip: next, jobIds: exp.jobIds };
    });
    runJobsAfterCommit(r.jobIds, now);
    return r.trip;
  },

  /** draft|published → cancelled; cascades to bookings (rejected/cancelled + refunds). */
  async cancel(ctx: Ctx, tripId: Id, reason: string): Promise<TripDoc> {
    requireRole(ctx, "agency");
    const note = (reason ?? "").trim();
    if (note.length < 3 || note.length > V2.reasonMax) throw new DomainError("invalid_request", "Give a reason (3–300 characters).", { fields: { reason: "Required" } });
    const { now, actor } = ctx;
    const by = actorOfSession(actor);
    const r = await txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertAgencyOwns(actor, trip);
      const [dSched, vSched, agency] = await Promise.all([
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(trip.driverId)),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.vehicle(trip.vehicleId)),
        tx.get<AgencyDoc>(C.agencies, trip.agencyId),
      ]);
      const open = await openBookings(tx, trip.id);
      const deps = await closeDeps(tx, open);
      if (trip.status === "cancelled") return { trip, jobIds: [] as string[] };
      if (trip.status !== "draft" && trip.status !== "published") throw new DomainError("invalid_transition", "A trip that has started can't be cancelled.");
      if (open.some((b) => PICKED_UP_OR_LATER.includes(b.status))) throw new DomainError("trip_has_bookings", "Some shipments are already picked up.");

      let cur = trip;
      const jobIds: string[] = [];
      const notes: NotifyInput[] = [];
      for (const b of open) {
        const out = closeBooking(tx, {
          ...bundleFor(b, cur, agency, deps),
          event: "tripCancelled",
          by,
          now,
          rejectReason: "trip_cancelled",
          cancelReason: "trip_cancelled",
          note,
          refundReason: "trip_cancelled",
          deferTrip: true,
        });
        if (!out) continue;
        if (out.trip) cur = out.trip;
        jobIds.push(...out.refundJobIds);
        const refund = out.refundJobIds.length ? " A full refund has been started." : "";
        notes.push(msg.customer(out.booking, "trip_cancelled", "Trip cancelled", `${trip.agencyName} cancelled the trip for ${b.id}: ${note}.${refund} You can book another trip.`));
      }
      if (trip.status === "published") {
        tx.set(C.schedules, scheduleId.driver(trip.driverId), withoutTrip(dSched, "driver", trip.driverId, trip.id, now));
        tx.set(C.schedules, scheduleId.vehicle(trip.vehicleId), withoutTrip(vSched, "vehicle", trip.vehicleId, trip.id, now));
        notes.push({ userId: trip.driverId, role: "driver", kind: "trip_cancelled", title: "Trip cancelled", body: `${trip.agencyName} cancelled your trip departing ${trip.departureAt}: ${note}`, link: { type: "trip", id: trip.id } });
      }
      const next = bumped(cur, now, { status: "cancelled", cancelledAt: iso(now), cancelReason: note, pickupKeys: [] });
      tx.set(C.trips, trip.id, next);
      writeTripEvent(tx, tripEvent(trip.id, "cancelled", now, by, { remarks: note }));
      notifyMany(tx, notes, now);
      return { trip: next, jobIds };
    });
    runJobsAfterCommit(r.jobIds, now);
    return r.trip;
  },

  /** Swap the driver of a draft/published trip (schedule-checked, bookings fanned out). */
  async reassignDriver(ctx: Ctx, tripId: Id, driverId: Id): Promise<TripDoc> {
    requireRole(ctx, "agency");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertAgencyOwns(actor, trip);
      const [driver, driverUser, oldSched, newSched] = await Promise.all([
        tx.get<DriverDoc>(C.drivers, driverId),
        tx.get<UserDoc>(C.users, driverId),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(trip.driverId)),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(driverId)),
      ]);
      const open = await openBookings(tx, trip.id);
      if (trip.driverId === driverId) return trip;
      if (trip.status !== "draft" && trip.status !== "published") throw new DomainError("invalid_transition", "The driver can't be changed once the trip has started.");
      if (open.some((b) => PICKED_UP_OR_LATER.includes(b.status))) throw new DomainError("trip_has_bookings", "Some shipments are already picked up.");
      if (!driver || driver.agencyLink?.agencyId !== trip.agencyId || driver.agencyLink.status !== "active") throw new DomainError("driver_unavailable", "This driver isn't linked to your agency.");
      if (driver.availability !== "available" || !driverUser || driverUser.status !== "active") throw new DomainError("driver_unavailable");

      const at = iso(now);
      if (trip.status === "published") {
        const iv = intervalForTrip(trip);
        const c = findConflict(newSched, iv, now);
        if (c) throw new DomainError("driver_schedule_conflict", undefined, { details: { conflictingTripId: c.tripId } });
        tx.set(C.schedules, scheduleId.driver(trip.driverId), withoutTrip(oldSched, "driver", trip.driverId, trip.id, now));
        tx.set(C.schedules, scheduleId.driver(driverId), withInterval(newSched, "driver", driverId, iv, now));
      }
      const next = bumped(trip, now, {
        driverId,
        driver: { fullName: driver.fullName, photo: driver.photo ?? null, ratingAvg: driver.stats.ratingAvg, ratingCount: driver.stats.ratingCount },
      });
      tx.set(C.trips, trip.id, next);
      const notes: NotifyInput[] = [];
      for (const b of open) {
        tx.set(C.bookings, b.id, { ...b, driverId, display: { ...b.display, driverName: driver.fullName }, updatedAt: at, version: b.version + 1 });
        if (b.status === "confirmed") notes.push(msg.driver({ id: b.id, driverId }, "shipment_assigned", "New shipment assigned", `Pick up ${b.id} (${b.weightKg} kg) at ${b.pickup.placeName}.`));
      }
      if (trip.status === "published") {
        notes.push({ userId: driverId, role: "driver", kind: "trip_published", title: "New trip assigned", body: `You're now driving the trip departing ${trip.departureAt}.`, link: { type: "trip", id: trip.id } });
        notes.push({ userId: trip.driverId, role: "driver", kind: "trip_cancelled", title: "Trip reassigned", body: `The trip departing ${trip.departureAt} was assigned to another driver.`, link: { type: "trip", id: trip.id } });
      }
      notifyMany(tx, notes, now);
      return next;
    });
  },

  /** Driver arrives at / departs checkpoint `index`. Departing 0 starts the trip. */
  async checkpoint(ctx: Ctx, tripId: Id, index: number, kind: "arrive" | "depart", i: { remarks?: string; clientAt?: IsoDateTime }): Promise<TripDoc> {
    requireRole(ctx, "driver");
    const { now, actor } = ctx;
    const remarks = (i.remarks ?? "").trim() || null;
    if (remarks && remarks.length > V2.reasonMax) throw new DomainError("invalid_request", "Keep remarks under 300 characters.", { fields: { remarks: "Too long" } });
    const by = actorOfSession(actor);
    const r = await txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertDriverAssigned(actor, trip);
      const agency = await tx.get<AgencyDoc>(C.agencies, trip.agencyId);
      const open = await openBookings(tx, trip.id);
      const deps = await closeDeps(tx, open);

      const cps = trip.checkpoints;
      const last = cps.length - 1;
      const cp = cps[index];
      if (!cp || (kind === "arrive" && index === 0) || (kind === "depart" && index === last)) throw new DomainError("checkpoint_out_of_order");
      const done = kind === "arrive" ? cp.actualArrivalAt : cp.actualDepartureAt;
      if (done) return { trip, jobIds: [] as string[] }; // idempotent
      const expected = nextStep(trip);
      if (!expected || expected.index !== index || expected.kind !== kind) throw new DomainError("checkpoint_out_of_order");
      if (index === 0) {
        if (trip.status !== "published") throw new DomainError("invalid_transition", "This trip isn't ready to start.");
        if (now.getTime() < t(trip.departureAt) - V2.tripStartWindowMinutes * 60_000) throw new DomainError("too_early", "You can start this trip up to 2 hours before departure.");
      } else if (trip.status !== "in_progress") throw new DomainError("invalid_transition", "Start the trip first.");

      const at = iso(now);
      const exp = expireDue(tx, trip, open, agency, deps, now);
      let cur = exp.trip;
      const checkpoints = cur.checkpoints.map((c) => (c.index === index ? { ...c, ...(kind === "arrive" ? { actualArrivalAt: at } : { actualDepartureAt: at }) } : c));
      cur = bumped(cur, now, {
        checkpoints,
        progress: { lastCheckpointIndex: index, lastEventAt: at },
        ...(index === 0 ? { status: "in_progress" as const, startedAt: at } : {}),
      });

      // Booking fan-out (P2 §5.1 auto transitions) + customer notifications.
      const notes: NotifyInput[] = [];
      for (const b of exp.remaining) {
        if (kind === "depart" && b.status === "picked_up" && b.pickup.checkpointIndex <= index) {
          const nb = transition(b, "startTransit", now, by)!;
          tx.set(C.bookings, b.id, nb);
          writeEvent(tx, bookingEvent(b.id, "in_transit", now, by, { checkpointIndex: index, placeName: cp.placeName, clientAt: i.clientAt ?? null }));
        } else if (kind === "arrive" && b.status === "in_transit" && b.drop.checkpointIndex <= index) {
          const nb = transition(b, "outForDelivery", now, by)!;
          tx.set(C.bookings, b.id, nb);
          writeEvent(tx, bookingEvent(b.id, "out_for_delivery", now, by, { checkpointIndex: index, placeName: cp.placeName, clientAt: i.clientAt ?? null }));
          notes.push(msg.customer(nb, "out_for_delivery", "Out for delivery", `${b.id} reached ${cp.placeName} and is out for delivery.`));
        } else if (kind === "arrive" && (b.status === "in_transit" || b.status === "picked_up") && b.pickup.checkpointIndex < index && index < b.drop.checkpointIndex) {
          notes.push(msg.customer(b, "checkpoint_reached", `Reached ${cp.placeName}`, `${b.id} reached ${cp.placeName} on the way to ${b.drop.placeName}.`));
        }
      }
      tx.set(C.trips, trip.id, cur);
      const evType: TripEventType = index === 0 ? "started" : kind === "arrive" ? "checkpoint_arrived" : "checkpoint_departed";
      writeTripEvent(tx, tripEvent(trip.id, evType, now, by, { checkpointIndex: index, remarks, clientAt: i.clientAt ?? null }));
      notifyMany(tx, notes, now);
      return { trip: cur, jobIds: exp.jobIds };
    });
    runJobsAfterCommit(r.jobIds, now);
    return r.trip;
  },

  /** in_progress → completed once the last checkpoint is reached and all held bookings are closed. */
  async complete(ctx: Ctx, tripId: Id): Promise<TripDoc> {
    requireRole(ctx, "driver");
    const { now, actor } = ctx;
    const by = actorOfSession(actor);
    const r = await txn(async (tx) => {
      const trip = await tx.get<TripDoc>(C.trips, tripId);
      assertDriverAssigned(actor, trip);
      const [agency, dSched, vSched] = await Promise.all([
        tx.get<AgencyDoc>(C.agencies, trip.agencyId),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.driver(trip.driverId)),
        tx.get<ScheduleDoc>(C.schedules, scheduleId.vehicle(trip.vehicleId)),
      ]);
      const open = await openBookings(tx, trip.id);
      const deps = await closeDeps(tx, open);
      if (trip.status === "completed") return { trip, jobIds: [] as string[] };
      if (trip.status !== "in_progress") throw new DomainError("invalid_transition", "Start the trip first.");
      if (!trip.checkpoints[trip.checkpoints.length - 1]!.actualArrivalAt) throw new DomainError("checkpoint_out_of_order", "Arrive at the final checkpoint first.");
      if (open.some((b) => ["confirmed", "picked_up", "in_transit", "out_for_delivery"].includes(b.status))) throw new DomainError("undelivered_shipments");
      // Unanswered requests and unpaid holds can no longer be served: close them.
      const exp = expireDue(tx, trip, open, agency, deps, now, true);
      const at = iso(now);
      tx.set(C.schedules, scheduleId.driver(trip.driverId), withoutTrip(dSched, "driver", trip.driverId, trip.id, now));
      tx.set(C.schedules, scheduleId.vehicle(trip.vehicleId), withoutTrip(vSched, "vehicle", trip.vehicleId, trip.id, now));
      const next = bumped(exp.trip, now, { status: "completed", completedAt: at, pickupKeys: [] });
      tx.set(C.trips, trip.id, next);
      writeTripEvent(tx, tripEvent(trip.id, "completed", now, by));
      return { trip: next, jobIds: exp.jobIds };
    });
    runJobsAfterCommit(r.jobIds, now);
    return r.trip;
  },
};

/** The next driver step for a trip (arrive i, depart i, arrive i+1 …), or null when finished. Pure. */
export function nextStep(trip: Pick<TripDoc, "checkpoints">): { index: number; kind: "arrive" | "depart" } | null {
  const cps = trip.checkpoints;
  const last = cps.length - 1;
  for (let i = 0; i <= last; i++) {
    const c = cps[i]!;
    if (i > 0 && !c.actualArrivalAt) return { index: i, kind: "arrive" };
    if (i < last && !c.actualDepartureAt) return { index: i, kind: "depart" };
  }
  return null;
}
