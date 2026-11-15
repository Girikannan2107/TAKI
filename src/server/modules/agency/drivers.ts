import "server-only";
/**
 * Agency ↔ driver links (P2 §3.8). Drivers join by invite (active at signup) or by request
 * (pending until the agency approves here). Removal sets the link to `removed` and is blocked
 * while the driver is on a published/in-progress trip. Assignment rules (active + available +
 * no schedule overlap) are enforced by core at publish/reassign time.
 */
import type { AgencyDriverDetailDTO, AgencyDriverDTO } from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import { listReviews, notify } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore, scheduleId } from "@/server/db";
import type { AgencyDoc, DriverDoc, ScheduleDoc, TripDoc } from "@/server/db/schema";
import { toAgencyDriverDTO, toAgencyTripListItem, scheduleSlots } from "@/server/views/agency";
import { toReviewDTO } from "@/server/views/common";
import { agencyIdOf, LIVE_TRIP_STATUSES, linkedDriver } from "./shared";

async function schedulesFor(driverIds: readonly string[]): Promise<Map<string, ScheduleDoc | null>> {
  if (driverIds.length === 0) return new Map();
  const docs = await getDocStore().getMany<ScheduleDoc>(C.schedules, driverIds.map((id) => scheduleId.driver(id)));
  return new Map(driverIds.map((id, i) => [id, docs[i] ?? null]));
}

export async function listDrivers(session: SessionContext, status: "active" | "pending" | "removed", now: Date): Promise<{ items: AgencyDriverDTO[] }> {
  const agencyId = agencyIdOf(session);
  const rows = await getDocStore().query<DriverDoc>(C.drivers, {
    where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", status]],
    orderBy: [["fullName", "asc"], ["__name__", "asc"]],
    limit: 200,
  });
  const schedules = await schedulesFor(rows.map((d) => d.id));
  return { items: rows.map((d) => toAgencyDriverDTO(d, schedules.get(d.id) ?? null, now)) };
}

export async function getDriver(session: SessionContext, driverId: string, now: Date): Promise<AgencyDriverDetailDTO> {
  const agencyId = agencyIdOf(session);
  const d = await linkedDriver(agencyId, driverId);
  const store = getDocStore();
  const [schedule, trips, reviews] = await Promise.all([
    store.get<ScheduleDoc>(C.schedules, scheduleId.driver(driverId)),
    store.query<TripDoc>(C.trips, { where: [["driverId", "==", driverId]], orderBy: [["departureAt", "desc"], ["__name__", "desc"]], limit: 50 }),
    listReviews(store, { driverId }, { limit: 10 }),
  ]);
  return {
    ...toAgencyDriverDTO(d, schedule, now),
    trips: trips.filter((t) => t.agencyId === agencyId).slice(0, 20).map((t) => toAgencyTripListItem(t, now)),
    reviews: reviews.filter((r) => r.agencyId === agencyId).map(toReviewDTO),
    schedule: scheduleSlots(schedule, now),
  };
}

export async function setAvailability(session: SessionContext, driverId: string, availability: "available" | "unavailable", now: Date): Promise<AgencyDriverDTO> {
  const agencyId = agencyIdOf(session);
  const next = await getDocStore().runTransaction(async (tx) => {
    const d = await tx.get<DriverDoc>(C.drivers, driverId);
    if (!d?.agencyLink || d.agencyLink.agencyId !== agencyId || d.agencyLink.status !== "active") throw new DomainError("not_found");
    const merged: DriverDoc = { ...d, availability, updatedAt: now.toISOString() };
    tx.set(C.drivers, driverId, merged);
    return merged;
  });
  return toAgencyDriverDTO(next, await getDocStore().get<ScheduleDoc>(C.schedules, scheduleId.driver(driverId)), now);
}

async function decideRequest(session: SessionContext, driverId: string, decision: "active" | "rejected", reason: string | null, now: Date): Promise<AgencyDriverDTO> {
  const agencyId = agencyIdOf(session);
  const at = now.toISOString();
  const next = await getDocStore().runTransaction(async (tx) => {
    const [d, agency] = await Promise.all([tx.get<DriverDoc>(C.drivers, driverId), tx.get<AgencyDoc>(C.agencies, agencyId)]);
    if (!d?.agencyLink || d.agencyLink.agencyId !== agencyId || !agency) throw new DomainError("not_found");
    if (d.agencyLink.status === decision) return d; // idempotent replay
    if (d.agencyLink.status !== "pending") throw new DomainError("invalid_transition", "This driver request has already been handled.");
    const merged: DriverDoc = { ...d, agencyLink: { ...d.agencyLink, status: decision, decidedAt: at }, updatedAt: at };
    tx.set(C.drivers, driverId, merged);
    if (decision === "active") tx.update(C.agencies, agencyId, { "stats.drivers": (agency.stats?.drivers ?? 0) + 1, updatedAt: at });
    notify(
      tx,
      decision === "active"
        ? { userId: driverId, role: "driver", kind: "driver_link_decided", title: `${agency.agencyName} approved you`, body: "You can now be assigned to trips.", link: { type: "profile", id: driverId } }
        : {
            userId: driverId,
            role: "driver",
            kind: "driver_link_decided",
            title: `${agency.agencyName} declined your request`,
            body: reason ? `Reason: ${reason}` : "You can request another agency from your profile.",
            link: { type: "profile", id: driverId },
          },
      now,
    );
    return merged;
  });
  return toAgencyDriverDTO(next, null, now);
}

export function approveDriver(session: SessionContext, driverId: string, now: Date): Promise<AgencyDriverDTO> {
  return decideRequest(session, driverId, "active", null, now);
}

export function rejectDriver(session: SessionContext, driverId: string, reason: string | undefined, now: Date): Promise<AgencyDriverDTO> {
  return decideRequest(session, driverId, "rejected", reason?.trim() || null, now);
}

/** Unlink (`removed`). Blocked while the driver is on a published or in-progress trip of this agency. */
export async function removeDriver(session: SessionContext, driverId: string, now: Date): Promise<void> {
  const agencyId = agencyIdOf(session);
  const at = now.toISOString();
  await getDocStore().runTransaction(async (tx) => {
    const d = await tx.get<DriverDoc>(C.drivers, driverId);
    if (!d?.agencyLink || d.agencyLink.agencyId !== agencyId || d.agencyLink.status === "removed") throw new DomainError("not_found");
    const live = await tx.query<TripDoc>(C.trips, { where: [["driverId", "==", driverId], ["status", "in", [...LIVE_TRIP_STATUSES]]], limit: 5 });
    if (live.some((t) => t.agencyId === agencyId))
      throw new DomainError("driver_has_active_trips", "This driver is assigned to upcoming or active trips. Reassign or cancel them first.");
    const agency = await tx.get<AgencyDoc>(C.agencies, agencyId);
    const wasActive = d.agencyLink.status === "active";
    tx.set(C.drivers, driverId, { ...d, agencyLink: { ...d.agencyLink, status: "removed", decidedAt: at }, updatedAt: at });
    if (wasActive && agency) tx.update(C.agencies, agencyId, { "stats.drivers": Math.max(0, (agency.stats?.drivers ?? 1) - 1), updatedAt: at });
    notify(tx, { userId: driverId, role: "driver", kind: "driver_link_decided", title: `${d.agencyLink.agencyName} removed you`, body: "You are no longer linked to this agency.", link: { type: "profile", id: driverId } }, now);
  });
}
