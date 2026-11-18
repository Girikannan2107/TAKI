/**
 * Trip validation rules (P2 §5.2, P3 §4.4 "Add Trip"). Pure and isomorphic: used by the agency
 * API contracts (zod superRefine), the trip module on the server and the Add Trip form.
 * Owner: D2.
 *
 * Times are ISO instants. The form edits them as IST wall-clock `datetime-local` strings,
 * converted with `istLocalToIso` / `isoToIstLocal`.
 */
import { V2 } from "./constants";
import type { GoodsCategory, SpecialHandling } from "./model";
import { getDistrict } from "./places/districts";
import { cumulativeKm, isKmOverrideAllowed } from "./places/geo";
import { getPlace } from "./places/places";

export interface CheckpointDraft {
  placeId: string;
  /** Optional agency override of the computed cumulative km (±30 %). */
  kmFromOrigin?: number | null;
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

const placeLabelOf = (placeId: string) => getPlace(placeId)?.name ?? "this stop";

/**
 * Structural + timing rules for an ordered checkpoint list (origin first, destination last):
 *  - 2..10 stops, every place known, no district visited twice;
 *  - origin needs a departure, destination an arrival, intermediate stops both (arrival ≤ departure);
 *  - times strictly increase along the route (departure of stop i < arrival at stop i+1).
 */
export function checkpointIssues(cps: readonly CheckpointDraft[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (cps.length < V2.minCheckpoints) issues.push({ path: "checkpoints", message: "Add a source and a destination." });
  if (cps.length > V2.maxCheckpoints) issues.push({ path: "checkpoints", message: `A trip can have at most ${V2.maxCheckpoints} stops including source and destination.` });

  const seenDistricts = new Map<string, number>();
  cps.forEach((c, i) => {
    const place = getPlace(c.placeId);
    if (!place) {
      issues.push({ path: `checkpoints.${i}.placeId`, message: "Choose a place from the list." });
      return;
    }
    const prev = seenDistricts.get(place.districtId);
    if (prev !== undefined) {
      const d = getDistrict(place.districtId);
      issues.push({ path: `checkpoints.${i}.placeId`, message: `${d?.name ?? "This district"} is already on this route.` });
    } else seenDistricts.set(place.districtId, i);
  });

  const last = cps.length - 1;
  let prevDeparture: number | null = null;
  let prevLabel = "";
  cps.forEach((c, i) => {
    const arr = ms(c.expectedArrivalAt);
    const dep = ms(c.expectedDepartureAt);
    const label = placeLabelOf(c.placeId);
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

/** Cumulative km per checkpoint (computed approx. road km, with validated overrides). */
export function checkpointKms(cps: readonly Pick<CheckpointDraft, "placeId" | "kmFromOrigin">[]): { kms: number[]; issues: RuleIssue[] } {
  const issues: RuleIssue[] = [];
  if (cps.some((c) => !getPlace(c.placeId))) return { kms: cps.map(() => 0), issues };
  const computed = cumulativeKm(cps.map((c) => c.placeId));
  const kms = computed.map((km, i) => {
    const o = cps[i]!.kmFromOrigin;
    if (i === 0 || o === undefined || o === null) return km;
    if (!isKmOverrideAllowed(km, o)) {
      issues.push({ path: `checkpoints.${i}.kmFromOrigin`, message: `Distance must be within 30% of the estimated ${km} km.` });
      return km;
    }
    return o;
  });
  for (let i = 1; i < kms.length; i++) {
    if (kms[i]! <= kms[i - 1]!) issues.push({ path: `checkpoints.${i}.kmFromOrigin`, message: "Distance from the source must increase along the route." });
  }
  return { kms, issues };
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

/** Departure window for publishing: ≥ now + 60 min and ≤ 60 days ahead. Null when OK. */
export function publishTimingProblem(departureAt: string, now: Date): string | null {
  const t = ms(departureAt);
  if (t === null) return "Enter the departure date and time.";
  if (t < now.getTime() + V2.publishMinLeadMinutes * 60_000) return `Departure must be at least ${V2.publishMinLeadMinutes} minutes from now to publish.`;
  if (t > now.getTime() + V2.publishMaxDaysAhead * 86_400_000) return `Trips can be published up to ${V2.publishMaxDaysAhead} days ahead.`;
  return null;
}

export interface PublishReadiness {
  agencyVerified: boolean;
  vehicleActive: boolean;
  driverActive: boolean;
  departureAt: string;
  now: Date;
}

/** Human-readable reasons a trip can't be published yet (empty = ready). The server re-checks in core. */
export function publishBlockers(i: PublishReadiness): string[] {
  const out: string[] = [];
  if (!i.agencyVerified) out.push("Your agency must be verified before you can publish trips.");
  if (!i.vehicleActive) out.push("The selected vehicle is not active.");
  if (!i.driverActive) out.push("The selected driver is not active or not available.");
  const t = publishTimingProblem(i.departureAt, i.now);
  if (t) out.push(t);
  return out;
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

/** Schedule interval used for overlap hints (mirrors core/schedules: ±60 min padding). */
export function scheduleWindow(departureAt: string, arrivalAt: string): { from: number; to: number } | null {
  const a = ms(departureAt);
  const b = ms(arrivalAt);
  if (a === null || b === null) return null;
  const pad = V2.scheduleBufferMinutes * 60_000;
  return { from: a - pad, to: b + pad };
}

export function windowsOverlap(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && b.from < a.to;
}
