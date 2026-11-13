/**
 * Quick ship / guest search (D3, v2): the dashboard "Quick ship" card and the guest
 * `/customer/vehicles?from&to&weight&date&cargo&handling` query share these rules.
 *
 * - source / destination: district ids from the places dataset (the matching unit), different
 * - weight: integer kg in LIMITS.weightKg (tonnes allowed in the form, ≤ 3 decimals, converted to kg)
 * - date: today (IST) … today + LIMITS.bookingWindowDays
 * - cargo: a v2 goods category (drives restriction matching)
 *
 * Date bounds depend on "today", so the schemas are built by factories.
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import { addDaysIso, isIsoDate } from "@/lib/domain/dates";
import { GOODS_CATEGORIES, SPECIAL_HANDLING, type GoodsCategory, type IsoDate, type SpecialHandling } from "@/lib/domain/model";
import { isDistrictId } from "@/lib/domain/places/districts";

export type WeightUnit = "kg" | "t";

export const WEIGHT_UNITS: ReadonlyArray<{ value: WeightUnit; label: string }> = [
  { value: "kg", label: "kg" },
  { value: "t", label: "tonnes" },
];

const fmt = (n: number) => n.toLocaleString("en-IN");

export const SHIPMENT_SEARCH_MESSAGES = {
  fromRequired: "Select a pickup district",
  toRequired: "Select a drop district",
  unknownDistrict: "Select a district from the list",
  sameDistrict: "Pickup and drop must be in different districts",
  weightRequired: "Enter the cargo weight",
  weightNumber: "Enter a number, e.g. 500",
  weightWholeKg: "Enter a whole number of kg",
  weightDecimals: "Use up to 3 decimal places",
  weightRange: `Weight must be between ${fmt(LIMITS.weightKg.min)} kg and ${fmt(LIMITS.weightKg.max)} kg`,
  dateRequired: "Select a shipping date",
  dateInvalid: "Enter a valid date",
  datePast: "Shipping date can't be in the past",
  dateTooFar: `Shipping date must be within the next ${LIMITS.bookingWindowDays} days`,
} as const;

const M = SHIPMENT_SEARCH_MESSAGES;

/** Latest bookable shipping date for a given IST "today". */
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

function checkDistrict(value: string, path: "from" | "to", ctx: Ctx): boolean {
  if (!value) {
    ctx.addIssue({ code: "custom", path: [path], message: path === "from" ? M.fromRequired : M.toRequired });
    return false;
  }
  if (!isDistrictId(value)) {
    ctx.addIssue({ code: "custom", path: [path], message: M.unknownDistrict });
    return false;
  }
  return true;
}

/** Weight issue message for a raw form value, or null when valid. */
export function weightProblem(raw: string, unit: WeightUnit): string | null {
  const value = raw.trim();
  if (value === "") return M.weightRequired;
  if (!/^\d*\.?\d*$/.test(value) || value === "." || Number.isNaN(Number(value))) return M.weightNumber;
  if (unit === "kg" && value.includes(".") && !/^\d+\.0*$/.test(value)) return M.weightWholeKg;
  if (unit === "t" && /\.\d{4,}$/.test(value)) return M.weightDecimals;
  const kg = weightToKg(value.endsWith(".") ? value.slice(0, -1) : value, unit);
  if (kg === null) return M.weightNumber;
  if (kg < LIMITS.weightKg.min || kg > LIMITS.weightKg.max) return M.weightRange;
  return null;
}

/** Date issue message (IST) or null. */
export function dateProblem(value: string, today: IsoDate): string | null {
  if (!value) return M.dateRequired;
  if (!isIsoDate(value)) return M.dateInvalid;
  if (value < today) return M.datePast;
  if (value > maxPickupDate(today)) return M.dateTooFar;
  return null;
}

export const CARGO_TYPES = GOODS_CATEGORIES;

/** Quick-ship form. All values are strings as typed; `toSearch()` converts the result. */
export function shipmentFormSchema(today: IsoDate) {
  return z
    .object({
      from: z.string(),
      to: z.string(),
      weight: z.string(),
      unit: z.enum(["kg", "t"]),
      date: z.string(),
      cargo: z.enum(GOODS_CATEGORIES as unknown as [GoodsCategory, ...GoodsCategory[]]),
    })
    .superRefine((v, ctx) => {
      const fromOk = checkDistrict(v.from, "from", ctx);
      const toOk = checkDistrict(v.to, "to", ctx);
      if (fromOk && toOk && v.from === v.to) ctx.addIssue({ code: "custom", path: ["to"], message: M.sameDistrict });
      const w = weightProblem(v.weight, v.unit);
      if (w) ctx.addIssue({ code: "custom", path: ["weight"], message: w });
      const d = dateProblem(v.date, today);
      if (d) ctx.addIssue({ code: "custom", path: ["date"], message: d });
    });
}

export type ShipmentFormValues = z.input<ReturnType<typeof shipmentFormSchema>>;

/** A district-level search (guest or before saving a shipment). */
export interface SearchCriteria {
  from: string;
  to: string;
  weightKg: number;
  date: IsoDate;
  goods: GoodsCategory;
  handling: SpecialHandling[];
}

export function toSearch(values: ShipmentFormValues): SearchCriteria {
  return { from: values.from, to: values.to, weightKg: weightToKg(values.weight, values.unit) ?? 0, date: values.date, goods: values.cargo, handling: [] };
}

export function searchToFormValues(s: Partial<SearchCriteria>, fallbackDate: IsoDate): ShipmentFormValues {
  return {
    from: s.from ?? "",
    to: s.to ?? "",
    weight: s.weightKg ? String(s.weightKg) : "",
    unit: "kg",
    date: s.date ?? fallbackDate,
    cargo: s.goods ?? "general_goods",
  };
}

type QueryLike = { get(name: string): string | null };

/** Partial prefill from a URL (new-shipment / vehicles). Invalid values are dropped. */
export function parseSearchPrefill(params: QueryLike): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  const from = params.get("from");
  const to = params.get("to");
  const weight = Number(params.get("weight"));
  const date = params.get("date");
  const cargo = params.get("cargo");
  const handling = (params.get("handling") ?? "").split(",").filter((h): h is SpecialHandling => (SPECIAL_HANDLING as readonly string[]).includes(h));
  if (from && isDistrictId(from)) out.from = from;
  if (to && isDistrictId(to) && to !== from) out.to = to;
  if (Number.isInteger(weight) && weight >= LIMITS.weightKg.min && weight <= LIMITS.weightKg.max) out.weightKg = weight;
  if (date && isIsoDate(date)) out.date = date;
  if (cargo && (GOODS_CATEGORIES as readonly string[]).includes(cargo)) out.goods = cargo as GoodsCategory;
  if (handling.length) out.handling = handling;
  return out;
}

/** Full guest search from a URL; null when incomplete or invalid (date in the past → null). */
export function parseSearchQuery(params: QueryLike, today: IsoDate): SearchCriteria | null {
  const p = parseSearchPrefill(params);
  if (!p.from || !p.to || !p.weightKg || !p.date) return null;
  if (dateProblem(p.date, today)) return null;
  return { from: p.from, to: p.to, weightKg: p.weightKg, date: p.date, goods: p.goods ?? "general_goods", handling: p.handling ?? [] };
}

/** URL params for a search (names match `paths.customer.vehicles`: from, to, weight, date, cargo, handling). */
export function searchParamsOf(s: Partial<SearchCriteria>): Record<string, string> {
  const q: Record<string, string> = {};
  if (s.from) q.from = s.from;
  if (s.to) q.to = s.to;
  if (s.weightKg) q.weight = String(s.weightKg);
  if (s.date) q.date = s.date;
  if (s.goods) q.cargo = s.goods;
  if (s.handling?.length) q.handling = s.handling.join(",");
  return q;
}
