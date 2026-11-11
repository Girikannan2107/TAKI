/**
 * Shipment search (D4): the dashboard "New Shipment" form and the
 * `/customer/vehicles` query (`from`, `to`, `weight`, `date`) share these rules.
 *
 * - source / destination: known CityIds, different from each other
 * - weight: integer kg in LIMITS.weightKg (tonnes allowed in the form, ≤ 3 decimals, converted to kg)
 * - pickup date: today (IST) … today + LIMITS.bookingWindowDays
 *
 * Date bounds depend on "today", so the schemas are built by factories.
 */
import { z } from "zod";
import { isCityId } from "@/lib/domain/cities";
import { LIMITS } from "@/lib/domain/constants";
import { addDaysIso, isIsoDate } from "@/lib/domain/dates";
import type { IsoDate, Shipment } from "@/lib/domain/types";
import { formatNumber } from "@/lib/format";

export type WeightUnit = "kg" | "t";

export const WEIGHT_UNITS: ReadonlyArray<{ value: WeightUnit; label: string }> = [
  { value: "kg", label: "kg" },
  { value: "t", label: "tonnes" },
];

export const SHIPMENT_SEARCH_MESSAGES = {
  fromRequired: "Select a source city",
  toRequired: "Select a destination city",
  unknownCity: "Select a city from the list",
  sameCity: "Source and destination must be different",
  weightRequired: "Enter the cargo weight",
  weightNumber: "Enter a number, e.g. 500",
  weightWholeKg: "Enter a whole number of kg",
  weightDecimals: "Use up to 3 decimal places",
  weightRange: `Weight must be between ${formatNumber(LIMITS.weightKg.min)} kg and ${formatNumber(LIMITS.weightKg.max)} kg`,
  dateRequired: "Select a pickup date",
  dateInvalid: "Enter a valid date",
  datePast: "Pickup date can't be in the past",
  dateTooFar: `Pickup date must be within the next ${LIMITS.bookingWindowDays} days`,
} as const;

const M = SHIPMENT_SEARCH_MESSAGES;

/** Latest bookable pickup date for a given IST "today". */
export function maxPickupDate(today: IsoDate): IsoDate {
  return addDaysIso(today, LIMITS.bookingWindowDays);
}

/** Converts a validated weight string to integer kg (null if not parseable). */
export function weightToKg(raw: string, unit: WeightUnit): number | null {
  const value = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return unit === "t" ? Math.round(n * 1000) : n;
}

/** Shows a kg amount in the given unit ("500" kg → "0.5" t). */
export function kgToUnitString(kg: number, unit: WeightUnit): string {
  if (unit === "kg") return String(kg);
  return String(Math.round(kg) / 1000);
}

type Ctx = z.RefinementCtx;

function checkCity(value: string, path: "from" | "to", ctx: Ctx): boolean {
  if (!value) {
    ctx.addIssue({ code: "custom", path: [path], message: path === "from" ? M.fromRequired : M.toRequired });
    return false;
  }
  if (!isCityId(value)) {
    ctx.addIssue({ code: "custom", path: [path], message: M.unknownCity });
    return false;
  }
  return true;
}

function checkWeight(raw: string, unit: WeightUnit, ctx: Ctx): void {
  const value = raw.trim();
  const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["weight"], message });
  if (value === "") return issue(M.weightRequired);
  if (!/^\d*\.?\d*$/.test(value) || value === "." || Number.isNaN(Number(value))) return issue(M.weightNumber);
  if (unit === "kg" && value.includes(".") && !/^\d+\.0*$/.test(value)) return issue(M.weightWholeKg);
  if (unit === "t" && /\.\d{4,}$/.test(value)) return issue(M.weightDecimals);
  const kg = weightToKg(value.endsWith(".") ? value.slice(0, -1) : value, unit);
  if (kg === null) return issue(M.weightNumber);
  if (kg < LIMITS.weightKg.min || kg > LIMITS.weightKg.max) return issue(M.weightRange);
}

function checkDate(value: string, today: IsoDate, ctx: Ctx): void {
  const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["date"], message });
  if (!value) return issue(M.dateRequired);
  if (!isIsoDate(value)) return issue(M.dateInvalid);
  if (value < today) return issue(M.datePast);
  if (value > maxPickupDate(today)) return issue(M.dateTooFar);
}

/** Dashboard form. All values are strings as typed; `toShipment()` converts the result. */
export function shipmentFormSchema(today: IsoDate) {
  return z
    .object({
      from: z.string(),
      to: z.string(),
      weight: z.string(),
      unit: z.enum(["kg", "t"]),
      date: z.string(),
    })
    .superRefine((v, ctx) => {
      const fromOk = checkCity(v.from, "from", ctx);
      const toOk = checkCity(v.to, "to", ctx);
      if (fromOk && toOk && v.from === v.to) ctx.addIssue({ code: "custom", path: ["to"], message: M.sameCity });
      checkWeight(v.weight, v.unit, ctx);
      checkDate(v.date, today, ctx);
    });
}

export type ShipmentFormValues = z.input<ReturnType<typeof shipmentFormSchema>>;

/** Converts validated form values into the search `Shipment` (weight in integer kg). */
export function toShipment(values: ShipmentFormValues): Shipment {
  return {
    sourceCityId: values.from,
    destinationCityId: values.to,
    weightKg: weightToKg(values.weight, values.unit) ?? 0,
    pickupDate: values.date,
  };
}

/** Form defaults from a saved search. */
export function shipmentToFormValues(s: Shipment): ShipmentFormValues {
  return { from: s.sourceCityId, to: s.destinationCityId, weight: String(s.weightKg), unit: "kg", date: s.pickupDate };
}

/** `/customer/vehicles` query: weight is always integer kg. */
export function shipmentQuerySchema(today: IsoDate) {
  return z
    .object({
      from: z.string().default(""),
      to: z.string().default(""),
      weight: z.string().default(""),
      date: z.string().default(""),
    })
    .superRefine((v, ctx) => {
      const fromOk = checkCity(v.from, "from", ctx);
      const toOk = checkCity(v.to, "to", ctx);
      if (fromOk && toOk && v.from === v.to) ctx.addIssue({ code: "custom", path: ["to"], message: M.sameCity });
      checkWeight(v.weight, "kg", ctx);
      checkDate(v.date, today, ctx);
    })
    .transform(
      (v): Shipment => ({
        sourceCityId: v.from,
        destinationCityId: v.to,
        weightKg: Number(v.weight),
        pickupDate: v.date,
      }),
    );
}

type QueryLike = { get(name: string): string | null };

/** Parses the vehicles query; null when anything is missing or invalid. */
export function parseShipmentQuery(params: QueryLike, today: IsoDate): Shipment | null {
  const raw = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    weight: params.get("weight") ?? undefined,
    date: params.get("date") ?? undefined,
  };
  const result = shipmentQuerySchema(today).safeParse(raw);
  return result.success ? result.data : null;
}

/** True when a saved search is still a valid search today (e.g. its date hasn't passed). */
export function isValidShipment(s: Shipment | null | undefined, today: IsoDate): s is Shipment {
  if (!s) return false;
  return shipmentQuerySchema(today).safeParse({
    from: s.sourceCityId,
    to: s.destinationCityId,
    weight: String(s.weightKg),
    date: s.pickupDate,
  }).success;
}

export function sameShipment(a: Shipment | null | undefined, b: Shipment | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.sourceCityId === b.sourceCityId &&
    a.destinationCityId === b.destinationCityId &&
    a.weightKg === b.weightKg &&
    a.pickupDate === b.pickupDate
  );
}
