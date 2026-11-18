/**
 * Trip ↔ shipment matching (P2 §7.2). Pure and isomorphic (D3).
 *
 * Used by customer search (`src/server/modules/customer/search.ts`), the vehicle-details
 * endpoint, and D5's booking-request transaction (`core.bookings.request`), so a trip that
 * is shown as bookable is exactly a trip the server will accept a request for.
 *
 * Checks, in order:
 *   1. trip is `published`                                   → "trip_not_bookable"
 *   2. stop order: pickup district before drop district      → "not_on_route"   (segments.locateSegment)
 *   3. date (only when `opts.date` is given): IST date of the pickup departure  → "wrong_date"
 *   4. not departed: now < respondBy (pickup departure − lead) → "departed"
 *   5. goods restrictions                                     → "goods_not_accepted" | "handling_not_supported" | "package_too_heavy"
 *   6. capacity: effective available kg ≥ weight              → "insufficient_capacity"
 *
 * Every problem except "wrong_date" is also an error code in the API catalog.
 */
import { effectiveAvailableKg, type CapacityTrip } from "./capacity";
import { isoDateFromInstant } from "./dates";
import type { DistrictId, GoodsCategory, IsoDate, IsoDateTime, PricingBreakdownV2, SpecialHandling, TripCheckpoint, TripStatus } from "./model";
import { quoteV2, segmentKm as segmentKmOf } from "./pricing";
import { checkpointArrivalAt, checkpointDepartureAt, goodsProblem, locateSegment, respondByFor, type GoodsProblem } from "./segments";

export type OfferProblem = "trip_not_bookable" | "not_on_route" | "wrong_date" | "departed" | GoodsProblem | "insufficient_capacity";

/** Problems that mean "this trip doesn't serve the shipment at all" (not counted in excluded notes). */
export const HARD_PROBLEMS: readonly OfferProblem[] = ["trip_not_bookable", "not_on_route", "wrong_date", "departed"];
/** Goods / handling / per-package weight restrictions (counted as "restricted goods" in search). */
export const RESTRICTION_PROBLEMS: readonly OfferProblem[] = ["goods_not_accepted", "handling_not_supported", "package_too_heavy"];

export const OFFER_PROBLEM_MESSAGE: Record<OfferProblem, string> = {
  trip_not_bookable: "This trip is no longer accepting bookings.",
  not_on_route: "This trip doesn't pass through your pickup and drop districts in that order.",
  wrong_date: "This trip doesn't leave your pickup district on your shipping date.",
  departed: "This trip has already left (or is about to leave) your pickup point.",
  goods_not_accepted: "This vehicle doesn't accept your goods category.",
  handling_not_supported: "This vehicle can't provide the temperature-controlled handling your goods need.",
  package_too_heavy: "Your package is heavier than this trip allows per package.",
  insufficient_capacity: "There isn't enough space left on this trip for your shipment.",
};

/** What matching needs from a shipment (a ShipmentDoc or a guest search both satisfy it via `shipmentForMatch`). */
export interface MatchShipment {
  sourceDistrictId: DistrictId;
  destinationDistrictId: DistrictId;
  weightKg: number;
  goodsCategory: GoodsCategory;
  specialHandling: readonly SpecialHandling[];
}

/** What matching needs from a trip (TripDoc satisfies it). */
export interface MatchTrip extends CapacityTrip {
  status: TripStatus;
  checkpoints: readonly TripCheckpoint[];
  departureAt: IsoDateTime;
  arrivalAt: IsoDateTime;
  goods: { accepted: readonly GoodsCategory[]; handlingSupported: readonly SpecialHandling[]; maxPackageKg: number | null };
  rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
}

export interface TripMatch {
  pickupIndex: number;
  dropIndex: number;
  pickup: TripCheckpoint;
  drop: TripCheckpoint;
  /** Expected departure from the pickup checkpoint. */
  pickupDepartureAt: IsoDateTime;
  /** Expected arrival at the drop checkpoint. */
  dropArrivalAt: IsoDateTime;
  /** IST date of the pickup departure. */
  pickupDate: IsoDate;
  /** Latest instant to request / accept (pickup departure − respond lead). */
  respondBy: IsoDateTime;
  segmentKm: number;
  availableKg: number;
  pricing: PricingBreakdownV2;
}

export type MatchResult =
  | { ok: true; match: TripMatch }
  /** `match` is present whenever the route order is valid, so the UI can still show the segment and price. */
  | { ok: false; problem: OfferProblem; match: TripMatch | null };

/** ShipmentDoc-like → MatchShipment. */
export function shipmentForMatch(s: {
  source: { districtId: DistrictId };
  destination: { districtId: DistrictId };
  package: { weightKg: number; goodsCategory: GoodsCategory; specialHandling: readonly SpecialHandling[] };
}): MatchShipment {
  return {
    sourceDistrictId: s.source.districtId,
    destinationDistrictId: s.destination.districtId,
    weightKg: s.package.weightKg,
    goodsCategory: s.package.goodsCategory,
    specialHandling: s.package.specialHandling,
  };
}

/** Segment, times and quote for a trip/shipment pair when the stop order is valid (no other checks). */
export function segmentQuote(trip: MatchTrip, shipment: MatchShipment, now: Date | IsoDateTime | number): TripMatch | null {
  const seg = locateSegment(trip.checkpoints, shipment.sourceDistrictId, shipment.destinationDistrictId);
  if (!seg) return null;
  const pickup = trip.checkpoints[seg.pickupIndex]!;
  const drop = trip.checkpoints[seg.dropIndex]!;
  const pickupDepartureAt = checkpointDepartureAt(pickup, trip.departureAt);
  const dropArrivalAt = checkpointArrivalAt(drop, trip.arrivalAt);
  const km = segmentKmOf(trip.checkpoints, seg.pickupIndex, seg.dropIndex);
  return {
    pickupIndex: seg.pickupIndex,
    dropIndex: seg.dropIndex,
    pickup,
    drop,
    pickupDepartureAt,
    dropArrivalAt,
    pickupDate: isoDateFromInstant(pickupDepartureAt),
    respondBy: respondByFor(pickupDepartureAt),
    segmentKm: km,
    availableKg: effectiveAvailableKg(trip, now),
    pricing: quoteV2({
      segmentKm: km,
      weightKg: shipment.weightKg,
      ratePerKmPaise: trip.rates.perKmPaise,
      ratePerKgPaise: trip.rates.perKgPaise,
      handlingFeeRupees: trip.rates.handlingFeeRupees,
      specialHandling: shipment.specialHandling,
    }),
  };
}

/**
 * Full match. `opts.date` (IST) restricts the pickup departure to that calendar day — search
 * passes it; the booking request does not (the customer may pick an adjacent day's trip).
 */
export function matchTrip(trip: MatchTrip, shipment: MatchShipment, now: Date | IsoDateTime | number, opts: { date?: IsoDate } = {}): MatchResult {
  const match = segmentQuote(trip, shipment, now);
  if (trip.status !== "published") return { ok: false, problem: "trip_not_bookable", match };
  if (!match) return { ok: false, problem: "not_on_route", match: null };
  if (opts.date && match.pickupDate !== opts.date) return { ok: false, problem: "wrong_date", match };
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (nowMs >= Date.parse(match.respondBy) || match.pickup.actualDepartureAt) return { ok: false, problem: "departed", match };
  const goods = goodsProblem(trip.goods, {
    goodsCategory: shipment.goodsCategory,
    specialHandling: shipment.specialHandling,
    weightKg: shipment.weightKg,
  });
  if (goods) return { ok: false, problem: goods, match };
  if (match.availableKg < shipment.weightKg) return { ok: false, problem: "insufficient_capacity", match };
  return { ok: true, match };
}

// ── Sorting and badges (search results) ──────────────────────────────────────

export type OfferSort = "price_asc" | "price_desc" | "departure_asc" | "arrival_asc";
export const OFFER_SORTS: readonly OfferSort[] = ["price_asc", "price_desc", "departure_asc", "arrival_asc"];

export interface SortableOffer {
  tripId: string;
  totalPayable: number;
  ratingAvg: number;
  availableKg: number;
  pickupDepartureAt: IsoDateTime;
  dropArrivalAt: IsoDateTime;
}

function tieBreak(a: SortableOffer, b: SortableOffer): number {
  return a.totalPayable - b.totalPayable || b.ratingAvg - a.ratingAvg || (a.tripId < b.tripId ? -1 : a.tripId > b.tripId ? 1 : 0);
}

/** Comparator per sort key; ties broken by price, then rating, then trip id (P2 §7.2). */
export function compareOffers(sort: OfferSort): (a: SortableOffer, b: SortableOffer) => number {
  switch (sort) {
    case "price_asc":
      return tieBreak;
    case "price_desc":
      return (a, b) => b.totalPayable - a.totalPayable || tieBreak(a, b);
    case "departure_asc":
      return (a, b) => Date.parse(a.pickupDepartureAt) - Date.parse(b.pickupDepartureAt) || tieBreak(a, b);
    case "arrival_asc":
      return (a, b) => Date.parse(a.dropArrivalAt) - Date.parse(b.dropArrivalAt) || tieBreak(a, b);
  }
}

export type OfferBadge = "best_price" | "top_rated" | "more_capacity";

/**
 * Phase 1 badges, kept: only with ≥ 2 results, one badge per offer, priority
 * best_price > top_rated > more_capacity. Returns tripId → badge.
 */
export function offerBadges(offers: readonly SortableOffer[]): Map<string, OfferBadge> {
  const out = new Map<string, OfferBadge>();
  if (offers.length < 2) return out;
  const byPrice = [...offers].sort(tieBreak);
  const pick = (score: (o: SortableOffer) => number, badge: OfferBadge) => {
    let best: SortableOffer | undefined;
    for (const o of byPrice) if (!best || score(o) > score(best)) best = o;
    if (best && !out.has(best.tripId)) out.set(best.tripId, badge);
  };
  pick((o) => -o.totalPayable, "best_price");
  pick((o) => o.ratingAvg, "top_rated");
  pick((o) => o.availableKg, "more_capacity");
  return out;
}
