/** Customer URL builders on top of `paths.customer.*` (D3). Query names are shared with the views. */
import { paths } from "@/lib/config/routes";
import type { OfferSort } from "@/lib/domain/matching";
import type { VehicleClass } from "@/lib/domain/model";
import { searchParamsOf, type SearchCriteria } from "@/lib/schemas/shipment-search.schema";
import { SORT_OPTIONS, isVehicleClass } from "./labels";

type QueryLike = { get(name: string): string | null };

/** Append (or replace) query params on a path that may already carry some. */
export function withParams(path: string, q: Record<string, string | number | undefined | null>): string {
  const [base, existing = ""] = path.split("?");
  const sp = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base!;
}

/** Either a saved shipment or a district-level search. */
export type SearchSource = { shipmentId: string } | { criteria: SearchCriteria };

export interface OfferFilterState {
  sort: OfferSort;
  types: VehicleClass[];
  minPrice?: number;
  maxPrice?: number;
  minKg?: number;
}

export const DEFAULT_FILTERS: OfferFilterState = { sort: "price_asc", types: [] };

const posInt = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export function parseFilters(params: QueryLike): OfferFilterState {
  const sort = params.get("sort");
  return {
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as OfferSort) : "price_asc",
    types: (params.get("types") ?? "").split(",").filter(isVehicleClass),
    minPrice: posInt(params.get("minPrice")),
    maxPrice: posInt(params.get("maxPrice")),
    minKg: posInt(params.get("minKg")),
  };
}

export function filterParams(f: OfferFilterState): Record<string, string | undefined> {
  return {
    sort: f.sort !== "price_asc" ? f.sort : undefined,
    types: f.types.length ? f.types.join(",") : undefined,
    minPrice: f.minPrice ? String(f.minPrice) : undefined,
    maxPrice: f.maxPrice ? String(f.maxPrice) : undefined,
    minKg: f.minKg ? String(f.minKg) : undefined,
  };
}

export function activeFilterCount(f: OfferFilterState): number {
  return (f.types.length ? 1 : 0) + (f.minPrice || f.maxPrice ? 1 : 0) + (f.minKg ? 1 : 0);
}

function sourceParams(src: SearchSource): Record<string, string> {
  return "shipmentId" in src ? { shipment: src.shipmentId } : searchParamsOf(src.criteria);
}

export function vehiclesHref(src: SearchSource, extra: { date?: string; filters?: OfferFilterState } = {}): string {
  return withParams(paths.customer.vehicles(), { ...sourceParams(src), ...(extra.filters ? filterParams(extra.filters) : {}), ...(extra.date ? { date: extra.date } : {}) });
}

export function vehicleDetailsHref(tripId: string, src: SearchSource): string {
  return withParams(paths.customer.booking(tripId), sourceParams(src));
}

/** New Shipment, prefilled from a search; `trip` returns to that vehicle after saving (offer kept through login). */
export function newShipmentHref(prefill: Partial<SearchCriteria> = {}, tripId?: string): string {
  return withParams(paths.customer.newShipment(), { ...searchParamsOf(prefill), trip: tripId });
}
