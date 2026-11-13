import "server-only";
/**
 * Agency trips (P2 §5.2, §8.5). This module owns DRAFT trips: create, edit, delete, validation,
 * preview, list/detail reads and the Add Trip form options. Everything that touches schedules,
 * capacity holds or bookings (publish, unpublish, cancel, driver reassignment) is delegated to
 * D5 `core.tripsLifecycle`. On a published trip only "safe" fields are edited here (rates,
 * offered capacity ≥ active holds, package limit, notes) inside a transaction.
 */
import {
  TripBody,
  TripPatchBody,
  TripPreviewBody,
  type AgencyTripDTO,
  type AgencyTripsTabValue,
  type TripFormOptionsDTO,
  type TripInput,
  type TripInputParsed,
  type TripListResponse,
  type TripPatchInput,
  type TripPreviewDTO,
  type TripPreviewInput,
  type ScheduleSlotDTO,
} from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import { heldKg } from "@/lib/domain/capacity";
import { newId } from "@/lib/domain/ids";
import type { TripStatus } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import { getPlace } from "@/lib/domain/places/places";
import { driverEarningsPreview, estimateDurationMins } from "@/lib/domain/pricing";
import { capacityIssues, checkpointKms, goodsIssues, publishBlockers, publishTimingProblem, type RuleIssue } from "@/lib/domain/trip-rules";
import { findConflict, intervalForTrip, tripsLifecycle } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore, scheduleId } from "@/server/db";
import type { AgencyDoc, BookingDoc, DriverDoc, ScheduleDoc, TripCheckpoint, TripDoc, VehicleDoc } from "@/server/db/schema";
import { decodeCursor, encodeCursor } from "@/server/http/cursor";
import { toAgencyTripDTO, toAgencyTripListItem } from "@/server/views/agency";
import { agencyIdOf, fieldError, linkedDriver, loadAgency, ownedTrip, ownedVehicle } from "./shared";

/** Draft defaults until the agency sets its rates on step 2 (₹12/km, ₹0.50/kg). */
export const DEFAULT_RATES = { perKmPaise: 1200, perKgPaise: 50 } as const;

export const TAB_STATUSES: Record<AgencyTripsTabValue, readonly TripStatus[]> = {
  upcoming: ["published"],
  active: ["in_progress"],
  completed: ["completed"],
  cancelled: ["cancelled"],
  drafts: ["draft"],
};

function invalid(issues: readonly RuleIssue[], code: "invalid_request" | "invalid_checkpoints" = "invalid_request"): DomainError {
  const fields: Record<string, string> = {};
  for (const i of issues) if (!(i.path in fields)) fields[i.path] = i.message;
  return new DomainError(code, issues[0]?.message, { fields });
}

function coreCtx(session: SessionContext, now: Date) {
  return { now, actor: session } as Parameters<typeof tripsLifecycle.publish>[0];
}

// ── Building a trip document from input ──────────────────────────────────────
interface BuildInput {
  agency: AgencyDoc;
  vehicle: VehicleDoc;
  driver: DriverDoc;
  body: TripInputParsed;
}

function buildCheckpoints(body: TripInputParsed): { checkpoints: TripCheckpoint[]; issues: RuleIssue[] } {
  const { kms, issues } = checkpointKms(body.checkpoints);
  const last = body.checkpoints.length - 1;
  const checkpoints = body.checkpoints.map((c, i): TripCheckpoint => {
    const place = getPlace(c.placeId)!;
    const district = getDistrict(place.districtId);
    return {
      index: i,
      placeId: place.id,
      placeName: place.name,
      districtId: place.districtId,
      districtName: district?.name ?? place.districtId,
      state: place.state,
      kmFromOrigin: kms[i] ?? 0,
      expectedArrivalAt: i === 0 ? null : c.expectedArrivalAt ? new Date(c.expectedArrivalAt).toISOString() : null,
      expectedDepartureAt: i === last ? null : c.expectedDepartureAt ? new Date(c.expectedDepartureAt).toISOString() : null,
      actualArrivalAt: null,
      actualDepartureAt: null,
    };
  });
  return { checkpoints, issues };
}

function validateAssignment({ vehicle, driver, body }: BuildInput): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (vehicle.status !== "active") issues.push({ path: "vehicleId", message: "This vehicle is inactive. Activate it or choose another." });
  if (driver.agencyLink?.status !== "active") issues.push({ path: "driverId", message: "Only approved drivers can be assigned." });
  else if (driver.availability !== "available") issues.push({ path: "driverId", message: `${driver.fullName} is marked unavailable.` });
  issues.push(...capacityIssues({ offeredKg: body.offeredKg, maxCapacityKg: body.maxCapacityKg ?? null, vehiclePayloadKg: vehicle.maxPayloadKg }));
  issues.push(...goodsIssues({ acceptedGoods: body.acceptedGoods, handlingSupported: body.handlingSupported }, vehicle));
  return issues;
}

function buildTripDoc(id: string, prev: TripDoc | null, i: BuildInput, now: Date): TripDoc {
  const { agency, vehicle, driver, body } = i;
  const { checkpoints, issues } = buildCheckpoints(body);
  const all = [...issues, ...validateAssignment(i)];
  if (all.length) throw invalid(all);
  const at = now.toISOString();
  const maxKg = Math.min(body.maxCapacityKg ?? vehicle.maxPayloadKg, vehicle.maxPayloadKg);
  return {
    id,
    agencyId: agency.id,
    agencyName: agency.agencyName,
    vehicleId: vehicle.id,
    vehicle: {
      vehicleClass: vehicle.vehicleClass,
      makeModel: vehicle.makeModel,
      registrationNumber: vehicle.registrationNumber,
      bodyType: vehicle.bodyType,
      photo: vehicle.photos[0] ?? null,
      imageKey: vehicle.imageKey,
    },
    driverId: driver.id,
    driver: { fullName: driver.fullName, photo: driver.photo ?? null, ratingAvg: driver.stats?.ratingAvg ?? 0, ratingCount: driver.stats?.ratingCount ?? 0 },
    status: "draft",
    checkpoints,
    departureAt: checkpoints[0]!.expectedDepartureAt!,
    arrivalAt: checkpoints[checkpoints.length - 1]!.expectedArrivalAt!,
    distanceKm: checkpoints[checkpoints.length - 1]!.kmFromOrigin,
    capacity: { vehicleMaxKg: maxKg, offeredKg: body.offeredKg },
    holds: prev?.holds ?? {},
    goods: { accepted: body.acceptedGoods, handlingSupported: body.handlingSupported, maxPackageKg: body.maxPackageKg, notes: body.goodsNotes },
    rates: {
      perKmPaise: body.ratePerKmPaise ?? prev?.rates.perKmPaise ?? DEFAULT_RATES.perKmPaise,
      perKgPaise: body.ratePerKgPaise ?? prev?.rates.perKgPaise ?? DEFAULT_RATES.perKgPaise,
      handlingFeeRupees: body.handlingFeeRupees,
    },
    pickupKeys: [],
    progress: prev?.progress ?? { lastCheckpointIndex: null, lastEventAt: null },
    counts: prev?.counts ?? { awaiting: 0, held: 0, delivered: 0 },
    publishedAt: prev?.publishedAt ?? null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: (prev?.version ?? 0) + 1,
    createdAt: prev?.createdAt ?? at,
    updatedAt: at,
  };
}

async function loadAssignment(agencyId: string, body: TripInputParsed): Promise<Omit<BuildInput, "body">> {
  const [agency, vehicle, driver] = await Promise.all([
    loadAgency(agencyId),
    ownedVehicle(agencyId, body.vehicleId).catch(() => {
      throw fieldError("not_found", "vehicleId", "Choose one of your vehicles.");
    }),
    linkedDriver(agencyId, body.driverId).catch(() => {
      throw fieldError("not_found", "driverId", "Choose one of your drivers.");
    }),
  ]);
  return { agency, vehicle, driver };
}

/** Advisory overlap check before publishing (core re-checks inside its transaction). */
async function assertSchedulesFree(trip: TripDoc, now: Date): Promise<void> {
  const store = getDocStore();
  const [ds, vs] = await store.getMany<ScheduleDoc>(C.schedules, [scheduleId.driver(trip.driverId), scheduleId.vehicle(trip.vehicleId)]);
  const iv = intervalForTrip(trip);
  const driverClash = findConflict(ds ?? null, iv, now);
  if (driverClash) {
    const other = await store.get<TripDoc>(C.trips, driverClash.tripId);
    const label = other ? ` (${other.checkpoints[0]?.placeName} → ${other.checkpoints[other.checkpoints.length - 1]?.placeName})` : "";
    throw fieldError("driver_schedule_conflict", "driverId", `${trip.driver.fullName} is already assigned to another trip${label} during this time.`, {
      conflictingTripId: driverClash.tripId,
    });
  }
  const vehicleClash = findConflict(vs ?? null, iv, now);
  if (vehicleClash) {
    throw fieldError("vehicle_schedule_conflict", "vehicleId", `${trip.vehicle.registrationNumber} is already on another trip during this time.`, {
      conflictingTripId: vehicleClash.tripId,
    });
  }
}

async function prePublishChecks(session: SessionContext, trip: TripDoc, now: Date): Promise<void> {
  const agency = await loadAgency(trip.agencyId);
  if (agency.verification.status !== "verified") throw new DomainError("agency_not_verified", "Your agency must be verified before you can publish trips.");
  const timing = publishTimingProblem(trip.departureAt, now);
  if (timing) throw new DomainError("invalid_checkpoints", timing, { fields: { "checkpoints.0.expectedDepartureAt": timing } });
  await assertSchedulesFree(trip, now);
}

async function publishWithCore(session: SessionContext, trip: TripDoc, now: Date): Promise<void> {
  await prePublishChecks(session, trip, now);
  try {
    await tripsLifecycle.publish(coreCtx(session, now), trip.id);
  } catch (e) {
    if (e instanceof DomainError) throw new DomainError(e.code, e.message, { status: e.status, fields: e.fields, details: { ...e.details, tripId: trip.id } });
    throw e;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────
export async function createTrip(session: SessionContext, raw: TripInput, now: Date): Promise<AgencyTripDTO> {
  const agencyId = agencyIdOf(session);
  const body = TripBody.parse(raw);
  const deps = await loadAssignment(agencyId, body);
  if (body.publish && deps.agency.verification.status !== "verified")
    throw new DomainError("agency_not_verified", "Your agency must be verified before you can publish trips. Save it as a draft for now.");
  const trip = buildTripDoc(newId("trp"), null, { ...deps, body }, now);
  if (body.publish) {
    const timing = publishTimingProblem(trip.departureAt, now);
    if (timing) throw new DomainError("invalid_checkpoints", timing, { fields: { "checkpoints.0.expectedDepartureAt": timing } });
    await assertSchedulesFree(trip, now);
  }
  await getDocStore().runTransaction(async (tx) => {
    tx.create(C.trips, trip.id, trip);
  });
  if (body.publish) await publishWithCore(session, trip, now);
  return getTrip(session, trip.id, now);
}

const PUBLISHED_EDITABLE = new Set(["ratePerKmPaise", "ratePerKgPaise", "handlingFeeRupees", "offeredKg", "maxPackageKg", "goodsNotes", "driverId"]);

function sameSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a) return true;
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Fields in the patch that would change something not editable on a published trip. */
function lockedChanges(t: TripDoc, p: TripPatchInput): string[] {
  const out: string[] = [];
  if (p.vehicleId !== undefined && p.vehicleId !== t.vehicleId) out.push("vehicleId");
  if (p.checkpoints !== undefined) {
    const same =
      p.checkpoints.length === t.checkpoints.length &&
      p.checkpoints.every((c, i) => {
        const cur = t.checkpoints[i]!;
        const eq = (a: string | null | undefined, b: string | null) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
        return c.placeId === cur.placeId && (i === 0 || eq(c.expectedArrivalAt, cur.expectedArrivalAt)) && (i === t.checkpoints.length - 1 || eq(c.expectedDepartureAt, cur.expectedDepartureAt));
      });
    if (!same) out.push("checkpoints");
  }
  if (!sameSet(p.acceptedGoods, t.goods.accepted)) out.push("acceptedGoods");
  if (!sameSet(p.handlingSupported, t.goods.handlingSupported)) out.push("handlingSupported");
  if (p.maxCapacityKg !== undefined && p.maxCapacityKg !== null && p.maxCapacityKg !== t.capacity.vehicleMaxKg) out.push("maxCapacityKg");
  return out.filter((k) => !PUBLISHED_EDITABLE.has(k));
}

export async function updateTrip(session: SessionContext, tripId: string, raw: TripPatchInput, now: Date): Promise<AgencyTripDTO> {
  const agencyId = agencyIdOf(session);
  const patch = TripPatchBody.parse(raw);
  const current = await ownedTrip(agencyId, tripId);

  if (current.status === "draft") {
    const merged: TripInputParsed = TripBody.parse({
      vehicleId: patch.vehicleId ?? current.vehicleId,
      driverId: patch.driverId ?? current.driverId,
      maxCapacityKg: patch.maxCapacityKg !== undefined ? patch.maxCapacityKg : current.capacity.vehicleMaxKg,
      offeredKg: patch.offeredKg ?? current.capacity.offeredKg,
      checkpoints:
        patch.checkpoints ??
        current.checkpoints.map((c) => ({ placeId: c.placeId, kmFromOrigin: c.kmFromOrigin, expectedArrivalAt: c.expectedArrivalAt, expectedDepartureAt: c.expectedDepartureAt })),
      acceptedGoods: patch.acceptedGoods ?? current.goods.accepted,
      handlingSupported: patch.handlingSupported ?? current.goods.handlingSupported,
      maxPackageKg: patch.maxPackageKg !== undefined ? patch.maxPackageKg : current.goods.maxPackageKg,
      goodsNotes: patch.goodsNotes !== undefined ? patch.goodsNotes : current.goods.notes,
      ratePerKmPaise: patch.ratePerKmPaise ?? current.rates.perKmPaise,
      ratePerKgPaise: patch.ratePerKgPaise ?? current.rates.perKgPaise,
      handlingFeeRupees: patch.handlingFeeRupees ?? current.rates.handlingFeeRupees,
      publish: false,
    });
    const deps = await loadAssignment(agencyId, merged);
    await getDocStore().runTransaction(async (tx) => {
      const fresh = await tx.get<TripDoc>(C.trips, tripId);
      if (!fresh || fresh.agencyId !== agencyId) throw new DomainError("not_found");
      if (fresh.status !== "draft") throw new DomainError("conflict", "This trip was published or cancelled meanwhile. Refresh and try again.");
      tx.set(C.trips, tripId, buildTripDoc(tripId, fresh, { ...deps, body: merged }, now));
    });
    return getTrip(session, tripId, now);
  }

  if (current.status !== "published") throw new DomainError("invalid_transition", "This trip can no longer be edited.");
  const locked = lockedChanges(current, patch);
  if (locked.length)
    throw new DomainError("trip_has_bookings", "Unpublish this trip to change its route, times, vehicle or goods.", {
      fields: Object.fromEntries(locked.map((k) => [k, "Can't change on a published trip"])),
    });

  if (patch.driverId !== undefined && patch.driverId !== current.driverId) {
    await reassignDriver(session, tripId, patch.driverId, now);
  }
  const hasSafe = ["ratePerKmPaise", "ratePerKgPaise", "handlingFeeRupees", "offeredKg", "maxPackageKg", "goodsNotes"].some((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (hasSafe) {
    await getDocStore().runTransaction(async (tx) => {
      const t = await tx.get<TripDoc>(C.trips, tripId);
      if (!t || t.agencyId !== agencyId) throw new DomainError("not_found");
      if (t.status !== "published") throw new DomainError("invalid_transition", "This trip can no longer be edited.");
      const offered = patch.offeredKg ?? t.capacity.offeredKg;
      if (offered > t.capacity.vehicleMaxKg) throw fieldError("capacity_exceeds_vehicle", "offeredKg", `At most ${t.capacity.vehicleMaxKg.toLocaleString("en-IN")} kg on this trip.`);
      const held = heldKg(t, now);
      if (offered < held) throw fieldError("capacity_below_booked", "offeredKg", `${held.toLocaleString("en-IN")} kg is already booked or reserved on this trip.`);
      tx.set(C.trips, tripId, {
        ...t,
        capacity: { ...t.capacity, offeredKg: offered },
        rates: {
          perKmPaise: patch.ratePerKmPaise ?? t.rates.perKmPaise,
          perKgPaise: patch.ratePerKgPaise ?? t.rates.perKgPaise,
          handlingFeeRupees: patch.handlingFeeRupees ?? t.rates.handlingFeeRupees,
        },
        goods: {
          ...t.goods,
          maxPackageKg: patch.maxPackageKg !== undefined ? patch.maxPackageKg : t.goods.maxPackageKg,
          notes: patch.goodsNotes !== undefined ? patch.goodsNotes : t.goods.notes,
        },
        updatedAt: now.toISOString(),
        version: t.version + 1,
      } satisfies TripDoc);
    });
  }
  return getTrip(session, tripId, now);
}

/** Only never-published drafts can be deleted (they have no booking history). */
export async function deleteDraft(session: SessionContext, tripId: string): Promise<void> {
  const agencyId = agencyIdOf(session);
  await getDocStore().runTransaction(async (tx) => {
    const t = await tx.get<TripDoc>(C.trips, tripId);
    if (!t || t.agencyId !== agencyId) throw new DomainError("not_found");
    if (t.status !== "draft" || t.publishedAt) throw new DomainError("invalid_transition", "Only unpublished drafts can be deleted. Cancel the trip instead.");
    tx.delete(C.trips, tripId);
  });
}

// ── Lifecycle (delegated to core) ────────────────────────────────────────────
export async function publishTrip(session: SessionContext, tripId: string, now: Date): Promise<AgencyTripDTO> {
  const t = await ownedTrip(agencyIdOf(session), tripId);
  if (t.status === "published") return getTrip(session, tripId, now);
  if (t.status !== "draft") throw new DomainError("invalid_transition", "Only draft trips can be published.");
  await publishWithCore(session, t, now);
  return getTrip(session, tripId, now);
}

export async function unpublishTrip(session: SessionContext, tripId: string, now: Date): Promise<AgencyTripDTO> {
  await ownedTrip(agencyIdOf(session), tripId);
  await tripsLifecycle.unpublish(coreCtx(session, now), tripId);
  return getTrip(session, tripId, now);
}

export async function cancelTrip(session: SessionContext, tripId: string, reason: string, now: Date): Promise<AgencyTripDTO> {
  await ownedTrip(agencyIdOf(session), tripId);
  await tripsLifecycle.cancel(coreCtx(session, now), tripId, reason);
  return getTrip(session, tripId, now);
}

export async function reassignDriver(session: SessionContext, tripId: string, driverId: string, now: Date): Promise<AgencyTripDTO> {
  const agencyId = agencyIdOf(session);
  const t = await ownedTrip(agencyId, tripId);
  const d = await linkedDriver(agencyId, driverId).catch(() => {
    throw fieldError("not_found", "driverId", "Choose one of your drivers.");
  });
  if (d.agencyLink?.status !== "active") throw fieldError("driver_unavailable", "driverId", "Only approved drivers can be assigned.");
  if (t.status === "draft") return updateTrip(session, tripId, { driverId }, now);
  await tripsLifecycle.reassignDriver(coreCtx(session, now), tripId, driverId);
  return getTrip(session, tripId, now);
}

// ── Reads ────────────────────────────────────────────────────────────────────
export async function tripPublishBlockers(trip: TripDoc, now: Date): Promise<string[]> {
  if (trip.status !== "draft") return [];
  const store = getDocStore();
  const [agency, vehicle, driver] = await Promise.all([
    store.get<AgencyDoc>(C.agencies, trip.agencyId),
    store.get<VehicleDoc>(C.vehicles, trip.vehicleId),
    store.get<DriverDoc>(C.drivers, trip.driverId),
  ]);
  return publishBlockers({
    agencyVerified: agency?.verification.status === "verified",
    vehicleActive: vehicle?.status === "active",
    driverActive: driver?.agencyLink?.agencyId === trip.agencyId && driver.agencyLink.status === "active" && driver.availability === "available",
    departureAt: trip.departureAt,
    now,
  });
}

export async function getTrip(session: SessionContext, tripId: string, now: Date): Promise<AgencyTripDTO> {
  const agencyId = agencyIdOf(session);
  const t = await ownedTrip(agencyId, tripId);
  const [bookings, blockers] = await Promise.all([
    getDocStore().query<BookingDoc>(C.bookings, {
      where: [["agencyId", "==", agencyId], ["tripId", "==", tripId]],
      orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
      limit: 100,
    }),
    tripPublishBlockers(t, now),
  ]);
  return toAgencyTripDTO(t, bookings, blockers, now);
}

export async function tripCounts(agencyId: string): Promise<TripListResponse["counts"]> {
  const store = getDocStore();
  const entries = await Promise.all(
    (Object.keys(TAB_STATUSES) as AgencyTripsTabValue[]).map(
      async (tab) => [tab, await store.count(C.trips, { where: [["agencyId", "==", agencyId], ["status", "in", [...TAB_STATUSES[tab]]]] })] as const,
    ),
  );
  return Object.fromEntries(entries) as TripListResponse["counts"];
}

export async function listTrips(session: SessionContext, q: { tab: AgencyTripsTabValue; cursor?: string; limit: number }, now: Date): Promise<TripListResponse> {
  const agencyId = agencyIdOf(session);
  const dir = q.tab === "upcoming" || q.tab === "active" ? "asc" : "desc";
  const rows = await getDocStore().query<TripDoc>(C.trips, {
    where: [["agencyId", "==", agencyId], ["status", "in", [...TAB_STATUSES[q.tab]]]],
    orderBy: [["departureAt", dir], ["__name__", dir]],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((t) => toAgencyTripListItem(t, now)),
    nextCursor: rows.length > q.limit && last ? encodeCursor([last.departureAt, last.id]) : null,
    counts: await tripCounts(agencyId),
  };
}

export function previewTrip(raw: TripPreviewInput): TripPreviewDTO {
  const body = TripPreviewBody.parse(raw);
  const unknown = body.checkpoints.findIndex((c) => !getPlace(c.placeId));
  if (unknown >= 0) throw fieldError("invalid_request", `checkpoints.${unknown}.placeId`, "Choose a place from the list.");
  const { kms, issues } = checkpointKms(body.checkpoints);
  const computed = checkpointKms(body.checkpoints.map((c) => ({ placeId: c.placeId }))).kms;
  if (issues.length) throw invalid(issues);
  const distanceKm = kms[kms.length - 1] ?? 0;
  return {
    checkpoints: body.checkpoints.map((c, i) => ({ placeId: c.placeId, placeName: getPlace(c.placeId)!.name, km: kms[i]!, computedKm: computed[i]! })),
    distanceKm,
    durationMins: estimateDurationMins(distanceKm),
    sampleWeightKg: body.sampleWeightKg,
    earningsPreview: driverEarningsPreview({ distanceKm, weightKg: body.sampleWeightKg, ratePerKmPaise: body.ratePerKmPaise, ratePerKgPaise: body.ratePerKgPaise }),
  };
}

/** Vehicles + approved drivers for the Add Trip selects, flagged busy in the requested window. */
export async function tripFormOptions(
  session: SessionContext,
  q: { departureAt?: string; arrivalAt?: string; excludeTripId?: string },
  now: Date,
): Promise<TripFormOptionsDTO> {
  const agencyId = agencyIdOf(session);
  const store = getDocStore();
  const [agency, vehicles, drivers] = await Promise.all([
    loadAgency(agencyId),
    store.query<VehicleDoc>(C.vehicles, {
      where: [["agencyId", "==", agencyId], ["status", "in", ["active", "inactive"]]],
      orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
      limit: 200,
    }),
    store.query<DriverDoc>(C.drivers, {
      where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", "active"]],
      orderBy: [["fullName", "asc"], ["__name__", "asc"]],
      limit: 200,
    }),
  ]);
  const window =
    q.departureAt && q.arrivalAt && Date.parse(q.arrivalAt) > Date.parse(q.departureAt)
      ? intervalForTrip({ id: q.excludeTripId ?? "__new__", departureAt: q.departureAt, arrivalAt: q.arrivalAt })
      : null;
  const ids = [...vehicles.map((v) => scheduleId.vehicle(v.id)), ...drivers.map((d) => scheduleId.driver(d.id))];
  const schedules = window && ids.length ? await store.getMany<ScheduleDoc>(C.schedules, ids) : [];
  const busyOf = (i: number): ScheduleSlotDTO | null => {
    if (!window) return null;
    const c = findConflict(schedules[i] ?? null, window, now);
    return c ? { tripId: c.tripId, from: c.from, to: c.to } : null;
  };
  return {
    verification: agency.verification.status,
    vehicles: vehicles.map((v, i) => ({
      id: v.id,
      label: `${v.makeModel} · ${v.registrationNumber}`,
      registrationNumber: v.registrationNumber,
      maxPayloadKg: v.maxPayloadKg,
      acceptedGoods: v.acceptedGoods,
      handlingSupported: v.handlingSupported,
      status: v.status === "inactive" ? "inactive" : "active",
      busy: busyOf(i),
    })),
    drivers: drivers.map((d, j) => ({ id: d.id, fullName: d.fullName, availability: d.availability, busy: busyOf(vehicles.length + j) })),
  };
}
