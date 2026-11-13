import "server-only";
/**
 * Driver / vehicle schedule locks (P2 §6.4). `schedules/driver:{id}` and
 * `schedules/vehicle:{id}` hold busy intervals [departureAt − 60 min, arrivalAt + 60 min].
 * Reading both docs inside the publish/reassign transaction serialises concurrent
 * publishes for the same driver or vehicle.
 */
import { V2 } from "@/lib/domain/constants";
import type { ScheduleDoc, ScheduleInterval, TripDoc } from "../db/schema";

export function intervalForTrip(trip: Pick<TripDoc, "id" | "departureAt" | "arrivalAt">): ScheduleInterval {
  const pad = V2.scheduleBufferMinutes * 60_000;
  return {
    tripId: trip.id,
    from: new Date(Date.parse(trip.departureAt) - pad).toISOString(),
    to: new Date(Date.parse(trip.arrivalAt) + pad).toISOString(),
  };
}

export function overlaps(a: ScheduleInterval, b: ScheduleInterval): boolean {
  return Date.parse(a.from) < Date.parse(b.to) && Date.parse(b.from) < Date.parse(a.to);
}

/** First interval (other than `exceptTripId`) overlapping `iv`, or null. */
export function findConflict(schedule: ScheduleDoc | null, iv: ScheduleInterval, now: Date): ScheduleInterval | null {
  if (!schedule) return null;
  return schedule.intervals.find((x) => x.tripId !== iv.tripId && Date.parse(x.to) > now.getTime() && overlaps(x, iv)) ?? null;
}

/** Intervals with `iv` added (replacing any for the same trip), past ones pruned. */
export function withInterval(schedule: ScheduleDoc | null, kind: "driver" | "vehicle", resourceId: string, iv: ScheduleInterval, now: Date): ScheduleDoc {
  const keep = (schedule?.intervals ?? []).filter((x) => x.tripId !== iv.tripId && Date.parse(x.to) > now.getTime());
  return { id: `${kind}:${resourceId}`, kind, resourceId, intervals: [...keep, iv].sort((a, b) => a.from.localeCompare(b.from)), updatedAt: now.toISOString() };
}

/** Intervals without `tripId`, past ones pruned. */
export function withoutTrip(schedule: ScheduleDoc | null, kind: "driver" | "vehicle", resourceId: string, tripId: string, now: Date): ScheduleDoc {
  const keep = (schedule?.intervals ?? []).filter((x) => x.tripId !== tripId && Date.parse(x.to) > now.getTime());
  return { id: `${kind}:${resourceId}`, kind, resourceId, intervals: keep, updatedAt: now.toISOString() };
}
