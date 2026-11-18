/**
 * Route-segment and goods checks shared by search (D3 `matching.ts`) and the booking
 * transaction (D5 core). Pure and isomorphic (P2 §7.2).
 */
import { V2 } from "./constants";
import type { DistrictId, GoodsCategory, IsoDate, SpecialHandling, TripCheckpoint } from "./model";
import { isoDateFromInstant } from "./dates";

export interface Segment {
  pickupIndex: number;
  dropIndex: number;
}

/**
 * Order check: pickup = first checkpoint (except the last) in the source district; drop =
 * first checkpoint AFTER pickup in the destination district. Null when the trip doesn't
 * serve that direction.
 */
export function locateSegment(
  checkpoints: ReadonlyArray<Pick<TripCheckpoint, "districtId">>,
  sourceDistrictId: DistrictId,
  destinationDistrictId: DistrictId,
): Segment | null {
  const pickupIndex = checkpoints.findIndex((c, i) => i < checkpoints.length - 1 && c.districtId === sourceDistrictId);
  if (pickupIndex < 0) return null;
  for (let i = pickupIndex + 1; i < checkpoints.length; i++) {
    if (checkpoints[i]!.districtId === destinationDistrictId) return { pickupIndex, dropIndex: i };
  }
  return null;
}

/** Expected departure from a checkpoint (origin uses the trip departure). */
export function checkpointDepartureAt(c: Pick<TripCheckpoint, "expectedDepartureAt" | "expectedArrivalAt">, tripDepartureAt: string): string {
  return c.expectedDepartureAt ?? c.expectedArrivalAt ?? tripDepartureAt;
}

/** Expected arrival at a checkpoint (destination/intermediate). */
export function checkpointArrivalAt(c: Pick<TripCheckpoint, "expectedArrivalAt" | "expectedDepartureAt">, tripArrivalAt: string): string {
  return c.expectedArrivalAt ?? c.expectedDepartureAt ?? tripArrivalAt;
}

/** `${districtId}|${istDate}` keys for every pickup-able checkpoint (all but the last), deduped. */
export function pickupKeysFor(checkpoints: ReadonlyArray<Pick<TripCheckpoint, "districtId" | "expectedDepartureAt" | "expectedArrivalAt">>, departureAt: string): string[] {
  const keys = new Set<string>();
  checkpoints.slice(0, -1).forEach((c) => {
    keys.add(`${c.districtId}|${isoDateFromInstant(checkpointDepartureAt(c, departureAt))}`);
  });
  return [...keys];
}

export function pickupKey(districtId: DistrictId, date: IsoDate): string {
  return `${districtId}|${date}`;
}

/** Latest instant at which the agency can still accept (and a customer can request). */
export function respondByFor(pickupDepartureAt: string): string {
  return new Date(Date.parse(pickupDepartureAt) - V2.respondLeadMinutes * 60_000).toISOString();
}

export type GoodsProblem = "goods_not_accepted" | "handling_not_supported" | "package_too_heavy";

/**
 * Goods rules: category must be accepted; only `temperature_sensitive` handling must be
 * supported (other flags are instructions); maxPackageKg null or ≥ weight.
 */
export function goodsProblem(
  goods: { accepted: readonly GoodsCategory[]; handlingSupported: readonly SpecialHandling[]; maxPackageKg: number | null },
  pkg: { goodsCategory: GoodsCategory; specialHandling: readonly SpecialHandling[]; weightKg: number },
): GoodsProblem | null {
  if (!goods.accepted.includes(pkg.goodsCategory)) return "goods_not_accepted";
  if (pkg.specialHandling.includes("temperature_sensitive") && !goods.handlingSupported.includes("temperature_sensitive")) return "handling_not_supported";
  if (goods.maxPackageKg !== null && goods.maxPackageKg < pkg.weightKg) return "package_too_heavy";
  return null;
}
