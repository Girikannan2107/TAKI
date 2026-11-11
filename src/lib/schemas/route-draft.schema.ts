/**
 * Add New Route form (D7) — step 1 of route creation. Values are kept as typed
 * strings; `toRouteDraftPatch()` converts them into the `routeDraft` slice.
 *
 * - From / To: known CityIds, different from each other
 * - Stops: ≤ LIMITS.maxStops, unique, not From/To
 * - Travel date: today (IST) … today + LIMITS.bookingWindowDays
 * - Departure: "HH:mm"; a route leaving today must leave ≥ LIMITS.sameDayLeadMinutes from now
 * - Vehicle: required; total capacity integer kg in [LIMITS.capacityKg.min, vehicle max]
 * - Available capacity: integer kg in [LIMITS.capacityKg.min, total]
 *
 * "Today", "now" and the vehicle lookups vary at runtime, so the schema is built by a factory.
 */
import { z } from "zod";
import { isCityId } from "@/lib/domain/cities";
import { LIMITS } from "@/lib/domain/constants";
import { addDaysIso, departureMs, isIsoDate, isTimeOfDay } from "@/lib/domain/dates";
import type { IsoDate, RouteDraft } from "@/lib/domain/types";
import { formatNumber, formatTime } from "@/lib/format";

export const ROUTE_DRAFT_MESSAGES = {
  fromRequired: "Select the city you're starting from",
  toRequired: "Select the city you're going to",
  unknownCity: "Select a city from the list",
  sameCity: "From and To must be different cities",
  tooManyStops: `Add at most ${LIMITS.maxStops} stops`,
  stopsInvalid: "Each stop must be a different city, and not your From or To city",
  dateRequired: "Choose a travel date",
  dateInvalid: "Enter a valid date",
  datePast: "Travel date can't be in the past",
  dateTooFar: `Travel date must be within the next ${LIMITS.bookingWindowDays} days`,
  timeRequired: "Choose a departure time",
  timeTooSoon: "Departure must be at least 1 hour from now",
  vehicleRequired: "Choose a vehicle type",
  totalRequired: "Enter the total capacity",
  availableRequired: "Enter the available capacity",
  wholeKg: "Enter a whole number of kg, e.g. 3000",
  totalMin: `Total capacity must be at least ${formatNumber(LIMITS.capacityKg.min)} kg`,
  availableMin: `Available capacity must be at least ${formatNumber(LIMITS.capacityKg.min)} kg`,
  totalOverVehicle: (maxKg: number) => `Total capacity can't exceed this vehicle's ${formatNumber(maxKg)} kg limit`,
  availableOverTotal: "Available capacity can't exceed total capacity",
} as const;

const M = ROUTE_DRAFT_MESSAGES;

/** 30-minute departure slots: "00:00" … "23:30", labelled "08:00 AM". */
export const DEPARTURE_TIME_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value, label: formatTime(value) };
});

export function maxTravelDate(today: IsoDate): IsoDate {
  return addDaysIso(today, LIMITS.bookingWindowDays);
}

/** "3,000" | " 3000 " → 3000; null unless a whole, non-negative number. */
export function parseKg(raw: string | undefined): number | null {
  const value = (raw ?? "").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export interface RouteDraftSchemaContext {
  today: IsoDate;
  /** Current instant in ms (for the same-day 1-hour lead rule). */
  nowMs: number;
  /** Max payload for a Vehicle Type value (vehicle id or "new:<model>"). */
  maxPayloadFor(vehicleValue: string): number | undefined;
  /** Message when the chosen vehicle already has a published route that day; null when free. */
  vehicleClash?(vehicleValue: string, date: IsoDate): string | null;
}

export function routeDraftFormSchema(ctx: RouteDraftSchemaContext) {
  return z
    .object({
      from: z.string(),
      to: z.string(),
      stops: z.array(z.string()),
      date: z.string(),
      time: z.string(),
      vehicleId: z.string(),
      totalCapacity: z.string(),
      availableCapacity: z.string(),
    })
    .superRefine((v, rc) => {
      const issue = (path: string, message: string) => rc.addIssue({ code: "custom", path: [path], message });

      // Cities
      const checkCity = (path: "from" | "to", value: string, requiredMessage: string): boolean => {
        if (!value) issue(path, requiredMessage);
        else if (!isCityId(value)) issue(path, M.unknownCity);
        else return true;
        return false;
      };
      const fromOk = checkCity("from", v.from, M.fromRequired);
      const toOk = checkCity("to", v.to, M.toRequired);
      if (fromOk && toOk && v.from === v.to) issue("to", M.sameCity);

      // Stops
      if (v.stops.length > LIMITS.maxStops) issue("stops", M.tooManyStops);
      else if (
        new Set(v.stops).size !== v.stops.length ||
        v.stops.some((s) => !isCityId(s) || s === v.from || s === v.to)
      )
        issue("stops", M.stopsInvalid);

      // Date + time
      let dateOk = false;
      if (!v.date) issue("date", M.dateRequired);
      else if (!isIsoDate(v.date)) issue("date", M.dateInvalid);
      else if (v.date < ctx.today) issue("date", M.datePast);
      else if (v.date > maxTravelDate(ctx.today)) issue("date", M.dateTooFar);
      else dateOk = true;

      if (!v.time || !isTimeOfDay(v.time)) issue("time", M.timeRequired);
      else if (dateOk && departureMs(v.date, v.time) < ctx.nowMs + LIMITS.sameDayLeadMinutes * 60_000) issue("time", M.timeTooSoon);

      // Vehicle + capacity
      const maxKg = v.vehicleId ? ctx.maxPayloadFor(v.vehicleId) : undefined;
      if (!v.vehicleId || maxKg === undefined) issue("vehicleId", M.vehicleRequired);
      else if (dateOk) {
        const clash = ctx.vehicleClash?.(v.vehicleId, v.date);
        if (clash) issue("vehicleId", clash);
      }

      let total: number | null = null;
      if (!v.totalCapacity.trim()) issue("totalCapacity", M.totalRequired);
      else if ((total = parseKg(v.totalCapacity)) === null) issue("totalCapacity", M.wholeKg);
      else if (total < LIMITS.capacityKg.min) issue("totalCapacity", M.totalMin);
      else if (maxKg !== undefined && total > maxKg) issue("totalCapacity", M.totalOverVehicle(maxKg));

      let available: number | null = null;
      if (!v.availableCapacity.trim()) issue("availableCapacity", M.availableRequired);
      else if ((available = parseKg(v.availableCapacity)) === null) issue("availableCapacity", M.wholeKg);
      else if (available < LIMITS.capacityKg.min) issue("availableCapacity", M.availableMin);
      else if (total !== null && available > total) issue("availableCapacity", M.availableOverTotal);
    });
}

export type RouteDraftFormValues = z.input<ReturnType<typeof routeDraftFormSchema>>;

/** Form values → `routeDraft` patch. Invalid numbers become undefined (pricing rates are left untouched). */
export type RouteDraftFormSnapshot = { [K in Exclude<keyof RouteDraftFormValues, "stops">]?: string } & {
  stops?: ReadonlyArray<string | undefined>;
};

export function toRouteDraftPatch(v: RouteDraftFormSnapshot): Omit<RouteDraft, "ratePerKmPaise" | "ratePerKgPaise"> {
  return {
    originCityId: v.from || undefined,
    destinationCityId: v.to || undefined,
    stopCityIds: (v.stops ?? []).filter((s): s is string => typeof s === "string" && s !== ""),
    travelDate: v.date || undefined,
    departureTime: v.time || undefined,
    vehicleId: v.vehicleId || undefined,
    totalCapacityKg: parseKg(v.totalCapacity) ?? undefined,
    offeredCapacityKg: parseKg(v.availableCapacity) ?? undefined,
  };
}

/** True when the draft has none of the Add Route fields filled in. */
export function isRouteDraftEmpty(d: RouteDraft): boolean {
  return (
    !d.originCityId &&
    !d.destinationCityId &&
    (d.stopCityIds?.length ?? 0) === 0 &&
    !d.travelDate &&
    !d.departureTime &&
    !d.vehicleId &&
    d.totalCapacityKg === undefined &&
    d.offeredCapacityKg === undefined
  );
}

/** Saved draft → form values. */
export function routeDraftToFormValues(d: RouteDraft): RouteDraftFormValues {
  return {
    from: d.originCityId ?? "",
    to: d.destinationCityId ?? "",
    stops: [...(d.stopCityIds ?? [])],
    date: d.travelDate ?? "",
    time: d.departureTime ?? "",
    vehicleId: d.vehicleId ?? "",
    totalCapacity: d.totalCapacityKg !== undefined ? String(d.totalCapacityKg) : "",
    availableCapacity: d.offeredCapacityKg !== undefined ? String(d.offeredCapacityKg) : "",
  };
}

/**
 * Editable starting values when no draft exists: the reference board example
 * (Coimbatore → Salem → Vellore → Chennai, 08:00, 3,000 / 2,000 kg). The date is
 * today + 3 so it doesn't collide with the seeded routes on T+1 / T+2.
 */
export function exampleRouteFormValues(today: IsoDate, vehicle?: { value: string; maxPayloadKg: number }): RouteDraftFormValues {
  const total = vehicle ? Math.min(3000, vehicle.maxPayloadKg) : 3000;
  return {
    from: "coimbatore",
    to: "chennai",
    stops: ["salem", "vellore"],
    date: addDaysIso(today, 3),
    time: "08:00",
    vehicleId: vehicle?.value ?? "",
    totalCapacity: String(total),
    availableCapacity: String(Math.min(2000, total)),
  };
}
