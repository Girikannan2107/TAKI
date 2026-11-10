/** Vehicle search & offers (data-contract.md §7). Pure functions over Db. */
import { cityName } from "./cities";
import { departureMs } from "./dates";
import type { Db } from "./db";
import { estimateDurationMins, quote } from "./pricing";
import type { CityId, Id, OfferBadge, Route, Shipment, VehicleOffer } from "./types";
import { getVehicleModel } from "./vehicles";

/** Ordered path of a route with cumulative km: origin(0) → stops → destination(distanceKm). */
export function routePath(route: Route): Array<{ cityId: CityId; km: number }> {
  return [
    { cityId: route.originCityId, km: 0 },
    ...route.stops.map((s) => ({ cityId: s.cityId, km: s.kmFromOrigin })),
    { cityId: route.destinationCityId, km: route.distanceKm },
  ];
}

export function routeCityIds(route: Route): CityId[] {
  return routePath(route).map((p) => p.cityId);
}

/** "Coimbatore → Salem → Vellore → Chennai" */
export function routePathLabel(route: Route): string {
  return routeCityIds(route).map(cityName).join(" → ");
}

export function routeDepartureMs(route: Route): number {
  return departureMs(route.travelDate, route.departureTime);
}

export function hasDeparted(route: Route, now: Date): boolean {
  return routeDepartureMs(route) <= now.getTime();
}

/** Build the offer for `shipment` on `route`, or null when pickup/drop are not on the route in order. */
export function offerFromRoute(db: Db, route: Route, shipment: Pick<Shipment, "sourceCityId" | "destinationCityId" | "weightKg">): VehicleOffer | null {
  const path = routePath(route);
  const pickupIdx = path.findIndex((p) => p.cityId === shipment.sourceCityId);
  const dropIdx = path.findIndex((p) => p.cityId === shipment.destinationCityId);
  if (pickupIdx < 0 || dropIdx < 0 || dropIdx <= pickupIdx) return null;
  const driver = db.drivers[route.driverId];
  const vehicle = db.vehicles[route.vehicleId];
  if (!driver || !vehicle) return null;
  const segment = path.slice(pickupIdx, dropIdx + 1);
  const segmentKm = segment[segment.length - 1]!.km - segment[0]!.km;
  const model = getVehicleModel(vehicle.modelId);
  return {
    routeId: route.id,
    driverId: route.driverId,
    vehicleId: route.vehicleId,
    businessName: driver.businessName,
    ratingAvg: driver.ratingAvg,
    ratingCount: driver.ratingCount,
    vehicleLabel: model?.label ?? vehicle.modelId,
    registrationNumber: vehicle.registrationNumber,
    imageKey: vehicle.imageKey,
    availableCapacityKg: route.availableCapacityKg,
    pickupCityId: shipment.sourceCityId,
    dropCityId: shipment.destinationCityId,
    pathCityIds: segment.map((p) => p.cityId),
    segmentKm,
    segmentDurationMins: estimateDurationMins(segmentKm),
    stopsCount: segment.length - 1,
    travelDate: route.travelDate,
    departureTime: route.departureTime,
    pricing: quote({
      distanceKm: segmentKm,
      weightKg: shipment.weightKg,
      ratePerKmPaise: route.ratePerKmPaise,
      ratePerKgPaise: route.ratePerKgPaise,
    }),
  };
}

export type OfferProblem = "not_found" | "not_published" | "departed" | "not_on_route" | "insufficient_capacity" | "own_route";

/** Why an offer cannot be booked right now (null = bookable). */
export function offerProblem(db: Db, route: Route | undefined, shipment: Shipment, now: Date, currentDriverId?: Id): OfferProblem | null {
  if (!route) return "not_found";
  if (route.status !== "published") return "not_published";
  if (hasDeparted(route, now)) return "departed";
  if (currentDriverId && route.driverId === currentDriverId) return "own_route";
  if (!offerFromRoute(db, route, shipment)) return "not_on_route";
  if (shipment.weightKg > route.availableCapacityKg) return "insufficient_capacity";
  return null;
}

export const OFFER_PROBLEM_MESSAGE: Record<OfferProblem, string> = {
  not_found: "This vehicle listing no longer exists.",
  not_published: "This route is no longer accepting bookings.",
  departed: "This vehicle has already departed.",
  not_on_route: "This vehicle doesn't travel between your pickup and drop cities.",
  insufficient_capacity: "Not enough space left on this vehicle for your cargo.",
  own_route: "You can't book your own route.",
};

export type SortKey = "best" | "price" | "rating" | "capacity" | "departure";

export interface SearchResult {
  offers: VehicleOffer[];
  /** Matching routes hidden only because they lack capacity. */
  excludedForCapacity: number;
}

export function searchOffers(db: Db, shipment: Shipment, opts: { now: Date; excludeDriverId?: Id; sort?: SortKey }): SearchResult {
  let excludedForCapacity = 0;
  const offers: VehicleOffer[] = [];
  for (const route of Object.values(db.routes)) {
    if (route.status !== "published") continue;
    if (route.travelDate !== shipment.pickupDate) continue;
    if (hasDeparted(route, opts.now)) continue;
    if (opts.excludeDriverId && route.driverId === opts.excludeDriverId) continue;
    const offer = offerFromRoute(db, route, shipment);
    if (!offer) continue;
    if (shipment.weightKg > route.availableCapacityKg) {
      excludedForCapacity++;
      continue;
    }
    offers.push(offer);
  }
  offers.sort(compareBest);
  assignBadges(offers);
  if (opts.sort && opts.sort !== "best") offers.sort(SORTERS[opts.sort]);
  return { offers, excludedForCapacity };
}

function compareBest(a: VehicleOffer, b: VehicleOffer): number {
  return (
    a.pricing.totalPayable - b.pricing.totalPayable ||
    b.ratingAvg - a.ratingAvg ||
    a.departureTime.localeCompare(b.departureTime) ||
    a.routeId.localeCompare(b.routeId)
  );
}

const SORTERS: Record<Exclude<SortKey, "best">, (a: VehicleOffer, b: VehicleOffer) => number> = {
  price: (a, b) => a.pricing.totalPayable - b.pricing.totalPayable || compareBest(a, b),
  rating: (a, b) => b.ratingAvg - a.ratingAvg || compareBest(a, b),
  capacity: (a, b) => b.availableCapacityKg - a.availableCapacityKg || compareBest(a, b),
  departure: (a, b) => a.departureTime.localeCompare(b.departureTime) || compareBest(a, b),
};

/** Badges only when ≥ 2 results; one badge per offer; priority best_price > top_rated > more_capacity. */
function assignBadges(sorted: VehicleOffer[]): void {
  if (sorted.length < 2) return;
  const pick = (score: (o: VehicleOffer) => number, badge: OfferBadge) => {
    let best: VehicleOffer | undefined;
    for (const o of sorted) if (!best || score(o) > score(best)) best = o;
    if (best && !best.badge) best.badge = badge;
  };
  pick((o) => -o.pricing.totalPayable, "best_price");
  pick((o) => o.ratingAvg, "top_rated");
  pick((o) => o.availableCapacityKg, "more_capacity");
}
