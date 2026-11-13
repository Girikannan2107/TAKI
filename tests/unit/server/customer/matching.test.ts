import { describe, expect, it } from "vitest";
import { compareOffers, matchTrip, offerBadges, segmentQuote, type MatchShipment, type SortableOffer } from "@/lib/domain/matching";
import { NOW, TOMORROW, tripDoc } from "./fixtures";

const ship = (over: Partial<MatchShipment> = {}): MatchShipment => ({
  sourceDistrictId: "salem",
  destinationDistrictId: "chennai",
  weightKg: 500,
  goodsCategory: "general_goods",
  specialHandling: [],
  ...over,
});

describe("matchTrip (P2 §7.2)", () => {
  const trip = tripDoc({ id: "trp_aaaaaaaaaaaaaaaaaaaa" });

  it("matches a segment in stop order and prices it with quoteV2", () => {
    const r = matchTrip(trip, ship(), NOW, { date: TOMORROW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.match.pickupIndex).toBe(1);
    expect(r.match.dropIndex).toBe(3);
    expect(r.match.segmentKm).toBe(333);
    // 333 km × ₹12 + 500 kg × ₹0.50 + ₹350 service fee
    expect(r.match.pricing.distanceCharge).toBe(3996);
    expect(r.match.pricing.weightCharge).toBe(250);
    expect(r.match.pricing.serviceFee).toBe(350);
    expect(r.match.pricing.totalPayable).toBe(3996 + 250 + 350);
    expect(r.match.pricing.lines.map((l) => l.code)).toEqual(["distance", "weight", "service_fee"]);
    expect(r.match.pickupDepartureAt).toBe(trip.checkpoints[1]!.expectedDepartureAt);
    expect(r.match.dropArrivalAt).toBe(trip.checkpoints[3]!.expectedArrivalAt);
    expect(r.match.respondBy).toBe(new Date(Date.parse(r.match.pickupDepartureAt) - 60 * 60_000).toISOString());
  });

  it("rejects the reverse direction and districts not on the route", () => {
    expect(matchTrip(trip, ship({ sourceDistrictId: "chennai", destinationDistrictId: "salem" }), NOW)).toMatchObject({ ok: false, problem: "not_on_route", match: null });
    expect(matchTrip(trip, ship({ sourceDistrictId: "madurai" }), NOW)).toMatchObject({ ok: false, problem: "not_on_route" });
    // The destination checkpoint cannot be a pickup.
    expect(matchTrip(trip, ship({ sourceDistrictId: "chennai", destinationDistrictId: "vellore" }), NOW)).toMatchObject({ ok: false, problem: "not_on_route" });
  });

  it("only checks the date when asked", () => {
    expect(matchTrip(trip, ship(), NOW, { date: "2026-11-22" })).toMatchObject({ ok: false, problem: "wrong_date" });
    expect(matchTrip(trip, ship(), NOW).ok).toBe(true);
  });

  it("is departed once now ≥ pickup departure − 60 min", () => {
    const dep = Date.parse(trip.checkpoints[1]!.expectedDepartureAt!);
    expect(matchTrip(trip, ship(), new Date(dep - 61 * 60_000)).ok).toBe(true);
    expect(matchTrip(trip, ship(), new Date(dep - 60 * 60_000))).toMatchObject({ ok: false, problem: "departed" });
  });

  it("is departed once the pickup checkpoint has actually departed, even if early", () => {
    const cps = trip.checkpoints.map((c, i) => (i === 1 ? { ...c, actualDepartureAt: NOW.toISOString() } : c));
    expect(matchTrip({ ...trip, checkpoints: cps }, ship(), NOW)).toMatchObject({ ok: false, problem: "departed" });
  });

  it("checks goods restrictions before capacity", () => {
    expect(matchTrip(trip, ship({ goodsCategory: "electronics" }), NOW)).toMatchObject({ ok: false, problem: "goods_not_accepted" });
    expect(matchTrip(trip, ship({ specialHandling: ["temperature_sensitive"] }), NOW)).toMatchObject({ ok: false, problem: "handling_not_supported" });
    // Other handling flags are instructions only, but add the handling fee.
    const fragile = matchTrip(trip, ship({ specialHandling: ["fragile", "keep_dry"] }), NOW);
    expect(fragile.ok).toBe(true);
    if (fragile.ok) expect(fragile.match.pricing.handlingFee).toBe(150);
    const capped = tripDoc({ id: "trp_bbbbbbbbbbbbbbbbbbbb", goods: { accepted: ["general_goods"], handlingSupported: [], maxPackageKg: 200, notes: null } });
    expect(matchTrip(capped, ship(), NOW)).toMatchObject({ ok: false, problem: "package_too_heavy" });
    const full = tripDoc({ id: "trp_cccccccccccccccccccc", goods: { accepted: ["electronics"], handlingSupported: [], maxPackageKg: null, notes: null }, capacity: { vehicleMaxKg: 3000, offeredKg: 100 } });
    expect(matchTrip(full, ship(), NOW)).toMatchObject({ ok: false, problem: "goods_not_accepted" });
  });

  it("counts only active holds against capacity", () => {
    const later = new Date(NOW.getTime() + 3600_000).toISOString();
    const earlier = new Date(NOW.getTime() - 60_000).toISOString();
    const t = tripDoc({
      id: "trp_dddddddddddddddddddd",
      holds: {
        TAKI100001: { kg: 1000, kind: "paid", dueAt: null },
        TAKI100002: { kg: 600, kind: "unpaid", dueAt: later },
        TAKI100003: { kg: 900, kind: "unpaid", dueAt: earlier }, // expired — ignored
      },
    });
    const r = matchTrip(t, ship({ weightKg: 400 }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.match.availableKg).toBe(400);
    expect(matchTrip(t, ship({ weightKg: 401 }), NOW)).toMatchObject({ ok: false, problem: "insufficient_capacity" });
  });

  it("reports unpublished trips but still quotes the segment", () => {
    const r = matchTrip({ ...trip, status: "in_progress" }, ship(), NOW);
    expect(r).toMatchObject({ ok: false, problem: "trip_not_bookable" });
    expect(r.ok ? null : r.match?.segmentKm).toBe(333);
    expect(segmentQuote(trip, ship({ sourceDistrictId: "madurai" }), NOW)).toBeNull();
  });
});

describe("offer sorting and badges", () => {
  const o = (tripId: string, totalPayable: number, ratingAvg: number, availableKg: number, dep: string, arr: string): SortableOffer => ({
    tripId,
    totalPayable,
    ratingAvg,
    availableKg,
    pickupDepartureAt: `2026-11-21T${dep}:00.000Z`,
    dropArrivalAt: `2026-11-21T${arr}:00.000Z`,
  });
  const offers = [o("trp_a", 3000, 4.0, 500, "05:00", "12:00"), o("trp_b", 2500, 4.8, 900, "07:00", "10:00"), o("trp_c", 2500, 3.0, 1500, "03:00", "14:00")];

  it("sorts by each key with price → rating → id tie-breaks", () => {
    const ids = (s: Parameters<typeof compareOffers>[0]) => [...offers].sort(compareOffers(s)).map((x) => x.tripId);
    expect(ids("price_asc")).toEqual(["trp_b", "trp_c", "trp_a"]);
    expect(ids("price_desc")).toEqual(["trp_a", "trp_b", "trp_c"]);
    expect(ids("departure_asc")).toEqual(["trp_c", "trp_a", "trp_b"]);
    expect(ids("arrival_asc")).toEqual(["trp_b", "trp_a", "trp_c"]);
  });

  it("assigns one badge per offer only when there are at least two", () => {
    const b = offerBadges(offers);
    expect(b.get("trp_b")).toBe("best_price");
    // trp_b is also top rated, so the badge goes to nobody else; capacity goes to trp_c.
    expect(b.get("trp_c")).toBe("more_capacity");
    expect(b.has("trp_a")).toBe(false);
    expect(offerBadges([offers[0]!]).size).toBe(0);
  });
});
