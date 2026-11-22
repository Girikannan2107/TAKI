/**
 * Add Trip form hints (client UX only). FastAPI validates every trip (contract §10.1 TripBody) and decides
 * publishability; these mirror its messages so the form can point at the field before a round trip.
 *
 * Times are ISO instants. The form edits them as IST wall-clock `datetime-local` strings,
 * converted with `istLocalToIso` / `isoToIstLocal`.
 */
import type { GoodsCategory, SpecialHandling } from "./model";

/** Most stops a trip may have, source and destination included. */
export const MAX_TRIP_STOPS = 10;

export interface CheckpointDraft {
  /** Google place id ("" until a place is chosen). */
  placeId: string;
  /** Display name for messages (optional). */
  label?: string;
  expectedArrivalAt: string | null;
  expectedDepartureAt: string | null;
}

export interface RuleIssue {
  /** Dotted path relative to the trip body, e.g. "checkpoints.2.expectedArrivalAt". */
  path: string;
  message: string;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Ordered checkpoints (origin first, destination last):
 *  - 2..10 stops, each with a chosen place, never the same place twice in a row;
 *  - origin needs a departure, destination an arrival, intermediate stops both (arrival ≤ departure);
 *  - times strictly increase along the route (departure of stop i < arrival at stop i+1).
 */
export function checkpointIssues(cps: readonly CheckpointDraft[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (cps.length < 2) issues.push({ path: "checkpoints", message: "Add a source and a destination." });
  if (cps.length > MAX_TRIP_STOPS) issues.push({ path: "checkpoints", message: `A trip can have at most ${MAX_TRIP_STOPS} stops including source and destination.` });

  cps.forEach((c, i) => {
    if (!c.placeId) issues.push({ path: `checkpoints.${i}.placeId`, message: "Choose a place from the suggestions." });
    else if (i > 0 && cps[i - 1]!.placeId === c.placeId)
      issues.push({ path: `checkpoints.${i}.placeId`, message: "This is the same place as the stop before it." });
  });

  const last = cps.length - 1;
  let prevDeparture: number | null = null;
  let prevLabel = "";
  cps.forEach((c, i) => {
    const arr = ms(c.expectedArrivalAt);
    const dep = ms(c.expectedDepartureAt);
    const label = c.label || (i === 0 ? "the source" : i === last ? "the destination" : `checkpoint ${i}`);
    if (i === 0) {
      if (dep === null) issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: "Enter the departure date and time." });
    } else if (i === last) {
      if (arr === null) issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: "Enter the arrival date and time." });
    } else {
      if (arr === null) issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: `Enter the expected arrival at ${label}.` });
      if (dep === null) issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: `Enter the expected departure from ${label}.` });
      if (arr !== null && dep !== null && dep < arr)
        issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: `Departure from ${label} can't be before arriving there.` });
    }
    if (i > 0 && arr !== null && prevDeparture !== null && arr <= prevDeparture)
      issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: `Arrival at ${label} must be after leaving ${prevLabel}.` });
    const effectiveDep = i === last ? null : dep;
    if (effectiveDep !== null) {
      prevDeparture = effectiveDep;
      prevLabel = label;
    } else if (arr !== null) {
      prevDeparture = arr;
      prevLabel = label;
    }
  });
  return issues;
}

/** Capacity rules: offered ≤ max ≤ vehicle payload, offered ≥ 100 kg. */
export function capacityIssues(i: { offeredKg: number; maxCapacityKg?: number | null; vehiclePayloadKg: number }): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const max = i.maxCapacityKg ?? i.vehiclePayloadKg;
  if (max > i.vehiclePayloadKg) issues.push({ path: "maxCapacityKg", message: `This vehicle can carry at most ${i.vehiclePayloadKg.toLocaleString("en-IN")} kg.` });
  if (i.offeredKg > Math.min(max, i.vehiclePayloadKg))
    issues.push({ path: "offeredKg", message: "Capacity for booking can't be more than the trip's maximum capacity." });
  if (i.offeredKg < 100) issues.push({ path: "offeredKg", message: "Offer at least 100 kg." });
  return issues;
}

/** Trip goods must be a subset of what the vehicle can carry / handle. */
export function goodsIssues(
  trip: { acceptedGoods: readonly GoodsCategory[]; handlingSupported: readonly SpecialHandling[] },
  vehicle: { acceptedGoods: readonly GoodsCategory[]; handlingSupported: readonly SpecialHandling[] },
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (trip.acceptedGoods.length === 0) issues.push({ path: "acceptedGoods", message: "Choose at least one goods category." });
  if (trip.acceptedGoods.some((g) => !vehicle.acceptedGoods.includes(g)))
    issues.push({ path: "acceptedGoods", message: "Some selected goods are restricted for this vehicle." });
  if (trip.handlingSupported.some((h) => !vehicle.handlingSupported.includes(h)))
    issues.push({ path: "handlingSupported", message: "This vehicle doesn't support some of the selected handling." });
  return issues;
}

// ── IST datetime-local helpers (the app runs on IST) ─────────────────────────
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-11-20T08:00" (IST wall clock) → ISO instant; null for empty/invalid. */
export function istLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = LOCAL_RE.exec(local.trim().slice(0, 16));
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** ISO instant → "2026-11-20T08:00" in IST (for datetime-local inputs). */
export function isoToIstLocal(iso: string | null | undefined): string {
  const t = ms(iso);
  if (t === null) return "";
  const d = new Date(t + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
