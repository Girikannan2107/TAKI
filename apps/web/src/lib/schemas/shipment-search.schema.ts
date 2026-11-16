/**
 * Quick ship / guest search: the dashboard "Quick ship" card and the guest
 * `/customer/vehicles?from&to&fromLabel&toLabel&weight&date&cargo&handling` query share these rules.
 *
 * - source / destination (v3): Google place ids (Places Autocomplete; `fake_*` from the local gazetteer)
 *   plus the text the user saw. Without Google Places only the text is known (`from` = ""): the dashboard
 *   then goes to the New Shipment form, which geocodes it server-side (E23) after login.
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

/** Google place id shape accepted by the API (`PlaceId`: 10–300 chars of [A-Za-z0-9_-]). */
export function isPlaceIdLike(v: string | null | undefined): v is string {
  return !!v && /^[A-Za-z0-9_-]{10,300}$/.test(v);
}

export type WeightUnit = "kg" | "t";

export const WEIGHT_UNITS: ReadonlyArray<{ value: WeightUnit; label: string }> = [
  { value: "kg", label: "kg" },
  { value: "t", label: "tonnes" },
];

const fmt = (n: number) => n.toLocaleString("en-IN");

export const SHIPMENT_SEARCH_MESSAGES = {
  fromRequired: "Enter the pickup town or city",
  toRequired: "Enter the drop town or city",
  sameDistrict: "Pickup and drop must be different places",
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

function checkPlace(label: string, path: "from" | "to", ctx: Ctx): boolean {
  if (label.trim().length < 3) {
    ctx.addIssue({ code: "custom", path: [path], message: path === "from" ? M.fromRequired : M.toRequired });
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
      fromLabel: z.string(),
      toLabel: z.string(),
      weight: z.string(),
      unit: z.enum(["kg", "t"]),
      date: z.string(),
      cargo: z.enum(GOODS_CATEGORIES as unknown as [GoodsCategory, ...GoodsCategory[]]),
    })
    .superRefine((v, ctx) => {
      const fromOk = checkPlace(v.fromLabel, "from", ctx);
      const toOk = checkPlace(v.toLabel, "to", ctx);
      const same = v.from && v.to ? v.from === v.to : v.fromLabel.trim().toLowerCase() === v.toLabel.trim().toLowerCase();
      if (fromOk && toOk && same) ctx.addIssue({ code: "custom", path: ["to"], message: M.sameDistrict });
      const w = weightProblem(v.weight, v.unit);
      if (w) ctx.addIssue({ code: "custom", path: ["weight"], message: w });
      const d = dateProblem(v.date, today);
      if (d) ctx.addIssue({ code: "custom", path: ["date"], message: d });
    });
}

export type ShipmentFormValues = z.input<ReturnType<typeof shipmentFormSchema>>;

/** A place-level search (guest or before saving a shipment). `from` / `to` are place ids ("" = text only). */
export interface SearchCriteria {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  weightKg: number;
  date: IsoDate;
  goods: GoodsCategory;
  handling: SpecialHandling[];
}

export function toSearch(values: ShipmentFormValues): SearchCriteria {
  return {
    from: values.from,
    to: values.to,
    fromLabel: values.fromLabel.trim(),
    toLabel: values.toLabel.trim(),
    weightKg: weightToKg(values.weight, values.unit) ?? 0,
    date: values.date,
    goods: values.cargo,
    handling: [],
  };
}

export function searchToFormValues(s: Partial<SearchCriteria>, fallbackDate: IsoDate): ShipmentFormValues {
  return {
    from: s.from ?? "",
    to: s.to ?? "",
    fromLabel: s.fromLabel ?? "",
    toLabel: s.toLabel ?? "",
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
  const fromLabel = params.get("fromLabel")?.trim().slice(0, 200);
  const toLabel = params.get("toLabel")?.trim().slice(0, 200);
  if (isPlaceIdLike(from)) out.from = from;
  if (isPlaceIdLike(to) && to !== from) out.to = to;
  if (fromLabel) out.fromLabel = fromLabel;
  if (toLabel) out.toLabel = toLabel;
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
  return {
    from: p.from,
    to: p.to,
    fromLabel: p.fromLabel ?? "Pickup",
    toLabel: p.toLabel ?? "Drop",
    weightKg: p.weightKg,
    date: p.date,
    goods: p.goods ?? "general_goods",
    handling: p.handling ?? [],
  };
}

/** URL params for a search (names match `paths.customer.vehicles`: from, to, weight, date, cargo, handling). */
export function searchParamsOf(s: Partial<SearchCriteria>): Record<string, string> {
  const q: Record<string, string> = {};
  if (s.from) q.from = s.from;
  if (s.to) q.to = s.to;
  if (s.fromLabel) q.fromLabel = s.fromLabel;
  if (s.toLabel) q.toLabel = s.toLabel;
  if (s.weightKg) q.weight = String(s.weightKg);
  if (s.date) q.date = s.date;
  if (s.goods) q.cargo = s.goods;
  if (s.handling?.length) q.handling = s.handling.join(",");
  return q;
}
