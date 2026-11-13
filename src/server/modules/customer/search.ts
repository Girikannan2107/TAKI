import "server-only";
/**
 * Route matching & vehicle details for customers (P2 §7.2, D3).
 *
 * One Firestore query per search: trips whose `pickupKeys` contain
 * "<sourceDistrict>|<IST date>" and are published, ordered by departure. Everything else
 * (stop order, departure lead, goods restrictions, capacity, user filters, sort, badges)
 * runs in memory through the pure `matchTrip` that the booking request also uses.
 */
import type { GuestSearchInput, OfferFilters, OffersResponse, TripDetailsDTO, TripOfferDTO } from "@/lib/api/contracts/customer";
import { DomainError } from "@/lib/api/contracts/errors";
import { todayIst } from "@/lib/domain/dates";
import {
  HARD_PROBLEMS,
  RESTRICTION_PROBLEMS,
  compareOffers,
  matchTrip,
  offerBadges,
  segmentQuote,
  shipmentForMatch,
  type MatchShipment,
  type TripMatch,
} from "@/lib/domain/matching";
import type { IsoDate } from "@/lib/domain/model";
import { pickupKey } from "@/lib/domain/segments";
import type { SessionContext } from "../../auth/guards";
import { listReviews } from "../../core/reviews";
import { C } from "../../db/collections";
import { getDocStore } from "../../db";
import type { AgencyDoc, DriverDoc, ShipmentDoc, TripDoc } from "../../db/schema";
import { offerFromMatch, toTripDetailsDTO } from "../../views/customer";
import { assertOwnShipment } from "./shipments";

/** Trips scanned per (district, day). */
const SCAN_LIMIT = 200;
/** Offers returned after filters (the client pages locally). */
const RESULT_LIMIT = 100;
/** Reviews shown on vehicle details. */
const DETAIL_REVIEWS = 5;

async function docsById<T extends { id: string }>(col: string, ids: readonly string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const docs = await getDocStore().getMany<T>(col, unique);
  return new Map(docs.filter((d): d is T => !!d).map((d) => [d.id, d]));
}

/** Core of both search endpoints. */
export async function findOffers(shipment: MatchShipment, date: IsoDate, filters: OfferFilters, now: Date, signedIn: boolean): Promise<OffersResponse> {
  const store = getDocStore();
  const trips = await store.query<TripDoc>(C.trips, {
    where: [
      ["pickupKeys", "array-contains", pickupKey(shipment.sourceDistrictId, date)],
      ["status", "==", "published"],
    ],
    orderBy: [["departureAt", "asc"]],
    limit: SCAN_LIMIT,
  });

  let excludedForCapacity = 0;
  let excludedForRestrictions = 0;
  const matched: Array<{ trip: TripDoc; match: TripMatch }> = [];
  for (const trip of trips) {
    const r = matchTrip(trip, shipment, now, { date });
    if (r.ok) {
      matched.push({ trip, match: r.match });
      continue;
    }
    if (HARD_PROBLEMS.includes(r.problem)) continue;
    if (r.problem === "insufficient_capacity") excludedForCapacity++;
    else if (RESTRICTION_PROBLEMS.includes(r.problem)) excludedForRestrictions++;
  }

  const [agencies, drivers] = await Promise.all([
    docsById<AgencyDoc>(C.agencies, matched.map((m) => m.trip.agencyId)),
    docsById<DriverDoc>(C.drivers, matched.map((m) => m.trip.driverId)),
  ]);

  const rows = matched
    // Defence in depth: only verified agencies can publish, but never show an unverified one.
    .filter(({ trip }) => agencies.get(trip.agencyId)?.verification.status === "verified")
    .filter(({ trip, match }) => {
      if (filters.vehicleClass?.length && !filters.vehicleClass.includes(trip.vehicle.vehicleClass)) return false;
      if (filters.minPrice !== undefined && match.pricing.totalPayable < filters.minPrice) return false;
      if (filters.maxPrice !== undefined && match.pricing.totalPayable > filters.maxPrice) return false;
      if (filters.minCapacityKg !== undefined && match.availableKg < filters.minCapacityKg) return false;
      return true;
    })
    .map(({ trip, match }) => ({
      trip,
      match,
      sortable: {
        tripId: trip.id,
        totalPayable: match.pricing.totalPayable,
        ratingAvg: agencies.get(trip.agencyId)?.stats.ratingAvg ?? 0,
        availableKg: match.availableKg,
        pickupDepartureAt: match.pickupDepartureAt,
        dropArrivalAt: match.dropArrivalAt,
      },
    }));

  const badges = offerBadges(rows.map((r) => r.sortable));
  const cmp = compareOffers(filters.sort);
  rows.sort((a, b) => cmp(a.sortable, b.sortable));

  const items: TripOfferDTO[] = rows.slice(0, RESULT_LIMIT).map(({ trip, match }) =>
    offerFromMatch(trip, match, {
      agency: agencies.get(trip.agencyId) ?? null,
      driver: drivers.get(trip.driverId) ?? null,
      signedIn,
      badge: badges.get(trip.id),
      now,
    }),
  );
  return { items, excludedForCapacity, excludedForRestrictions, date };
}

/** GET /api/customer/shipments/[id]/offers — the customer's saved shipment. */
export async function offersForShipment(session: SessionContext, shipmentId: string, filters: OfferFilters, now: Date): Promise<OffersResponse> {
  const s = await getDocStore().get<ShipmentDoc>(C.shipments, shipmentId);
  assertOwnShipment(session, s);
  const date = filters.date ?? s.shippingDate;
  return findOffers(shipmentForMatch(s), clampDate(date, now), filters, now, true);
}

/** GET /api/customer/search — guests (and signed-in customers before saving a shipment). */
export async function guestSearch(q: GuestSearchInput, now: Date, session: SessionContext | null): Promise<OffersResponse> {
  const shipment: MatchShipment = {
    sourceDistrictId: q.from,
    destinationDistrictId: q.to,
    weightKg: q.weightKg,
    goodsCategory: q.goods,
    specialHandling: q.handling ?? [],
  };
  const date = q.date ?? todayIst(now);
  return findOffers(shipment, clampDate(date, now), q, now, session !== null);
}

/** Searching a past day is pointless (and unbounded); use today instead. */
function clampDate(date: IsoDate, now: Date): IsoDate {
  const today = todayIst(now);
  return date < today ? today : date;
}

export interface TripDetailsInput {
  shipmentId?: string;
  from?: string;
  to?: string;
  weightKg?: number;
  goods?: MatchShipment["goodsCategory"];
  handling?: MatchShipment["specialHandling"];
}

/**
 * GET /api/customer/trips/[tripId] — vehicle details for a shipment (signed in) or a guest
 * search. Draft trips are invisible (404). Trips that can't be requested are returned with
 * `problem` so the page can explain why the CTA is disabled.
 */
export async function tripDetails(session: SessionContext | null, tripId: string, q: TripDetailsInput, now: Date): Promise<TripDetailsDTO> {
  const store = getDocStore();
  let shipment: MatchShipment;
  let existingBookingId: string | null = null;
  if (q.shipmentId) {
    if (!session || session.role !== "customer") throw new DomainError("unauthenticated");
    const s = await store.get<ShipmentDoc>(C.shipments, q.shipmentId);
    assertOwnShipment(session, s);
    shipment = shipmentForMatch(s);
    existingBookingId = s.currentBookingId;
  } else if (q.from && q.to && q.weightKg) {
    shipment = { sourceDistrictId: q.from, destinationDistrictId: q.to, weightKg: q.weightKg, goodsCategory: q.goods ?? "general_goods", specialHandling: q.handling ?? [] };
  } else {
    throw new DomainError("invalid_request", "Add your shipment details to see this vehicle's price.", { fields: { shipmentId: "Required" } });
  }

  const trip = await store.get<TripDoc>(C.trips, tripId);
  if (!trip || trip.status === "draft") throw new DomainError("not_found");
  const match = segmentQuote(trip, shipment, now);
  if (!match) throw new DomainError("not_on_route", "This vehicle doesn't travel between your pickup and drop districts in that order.");
  const result = matchTrip(trip, shipment, now);

  const [agency, driver, reviews] = await Promise.all([
    store.get<AgencyDoc>(C.agencies, trip.agencyId),
    store.get<DriverDoc>(C.drivers, trip.driverId),
    listReviews(store, { driverId: trip.driverId }, { limit: DETAIL_REVIEWS }),
  ]);
  if (!agency || agency.verification.status !== "verified") throw new DomainError("not_found");

  return toTripDetailsDTO(trip, match, {
    agency,
    driver,
    signedIn: session !== null,
    now,
    reviews,
    problem: result.ok ? null : result.problem,
    existingBookingId,
  });
}
