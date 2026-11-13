/**
 * Capacity ledger math (P2 §6.1). Pure and isomorphic.
 *
 * `trip.holds` is the ONLY ledger. A hold counts while it is paid, or unpaid with
 * `dueAt > now`. Expired unpaid holds stop counting the instant they expire, even
 * before any sweep deletes them, so a missed cron never strands capacity.
 */
import { HOLDING_STATUSES } from "./booking-machine";
import type { BookingStatus, CapacityHold, IsoDateTime } from "./model";

export interface CapacityTrip {
  capacity: { vehicleMaxKg: number; offeredKg: number };
  holds: Record<string, CapacityHold>;
}

function nowMs(now: Date | IsoDateTime | number): number {
  return now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
}

export function isHoldActive(hold: CapacityHold, now: Date | IsoDateTime | number): boolean {
  if (hold.kind === "paid") return true;
  return hold.dueAt !== null && Date.parse(hold.dueAt) > nowMs(now);
}

/** Σ kg of holds that currently count. */
export function heldKg(trip: Pick<CapacityTrip, "holds">, now: Date | IsoDateTime | number): number {
  let sum = 0;
  for (const h of Object.values(trip.holds)) if (isHoldActive(h, now)) sum += h.kg;
  return sum;
}

/** Σ kg of paid holds only. */
export function paidKg(trip: Pick<CapacityTrip, "holds">): number {
  let sum = 0;
  for (const h of Object.values(trip.holds)) if (h.kind === "paid") sum += h.kg;
  return sum;
}

/** offeredKg − active holds (never negative). */
export function effectiveAvailableKg(trip: CapacityTrip, now: Date | IsoDateTime | number): number {
  return Math.max(0, trip.capacity.offeredKg - heldKg(trip, now));
}

export function fits(trip: CapacityTrip, kg: number, now: Date | IsoDateTime | number, excludeHoldId?: string): boolean {
  let held = 0;
  for (const [id, h] of Object.entries(trip.holds)) if (id !== excludeHoldId && isHoldActive(h, now)) held += h.kg;
  return trip.capacity.offeredKg - held >= kg;
}

export interface InvariantBooking {
  id: string;
  status: BookingStatus;
  weightKg: number;
}

/**
 * P2 §6.1 invariant. Returns a list of violations (empty = OK):
 *  - Σ active holds ≤ offeredKg ≤ vehicleMaxKg
 *  - every hold belongs to a booking in a holding status with the same kg
 *  - every booking in a holding status (except expired-unpaid ones awaiting the sweep) has a hold
 */
export function capacityInvariant(trip: CapacityTrip, bookings: readonly InvariantBooking[], now: Date | IsoDateTime | number): string[] {
  const problems: string[] = [];
  const held = heldKg(trip, now);
  if (held > trip.capacity.offeredKg) problems.push(`held ${held} kg > offered ${trip.capacity.offeredKg} kg`);
  if (trip.capacity.offeredKg > trip.capacity.vehicleMaxKg)
    problems.push(`offered ${trip.capacity.offeredKg} kg > vehicle max ${trip.capacity.vehicleMaxKg} kg`);
  const byId = new Map(bookings.map((b) => [b.id, b]));
  for (const [id, hold] of Object.entries(trip.holds)) {
    const b = byId.get(id);
    if (!b) {
      problems.push(`hold ${id} has no booking`);
      continue;
    }
    if (!HOLDING_STATUSES.includes(b.status)) problems.push(`hold ${id} but booking is ${b.status}`);
    if (b.weightKg !== hold.kg) problems.push(`hold ${id} is ${hold.kg} kg but booking weighs ${b.weightKg} kg`);
  }
  for (const b of bookings) {
    if (HOLDING_STATUSES.includes(b.status) && !trip.holds[b.id]) problems.push(`booking ${b.id} is ${b.status} without a hold`);
  }
  return problems;
}
