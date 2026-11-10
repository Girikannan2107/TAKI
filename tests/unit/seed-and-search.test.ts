import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/data/seed";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import { capacityInvariantHolds, driverDashboardStats, earningsSummary } from "@/lib/domain/earnings";
import { searchOffers } from "@/lib/domain/search";

// 2026-11-10 15:00 IST
const NOW = new Date("2026-11-10T09:30:00.000Z");

describe("seed reproduces the reference board", () => {
  const db = buildSeed(NOW);
  const T = todayIst(NOW);
  const tomorrow = addDaysIso(T, 1);

  it("default search Coimbatore → Chennai, 500 kg, tomorrow → Raj ₹4,850 · Sree ₹5,200 · Kavin ₹5,450", () => {
    const { offers, excludedForCapacity } = searchOffers(
      db,
      { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: tomorrow },
      { now: NOW },
    );
    expect(offers.map((o) => [o.businessName, o.pricing.totalPayable, o.badge, o.availableCapacityKg, o.vehicleLabel])).toEqual([
      ["Raj Transport", 4850, "best_price", 2000, "Tata 407"],
      ["Sree Travels", 5200, "top_rated", 1500, "Eicher Pro"],
      ["Kavin Logistics", 5450, "more_capacity", 3000, "Ashok Leyland"],
    ]);
    expect(excludedForCapacity).toBe(1);
    const raj = offers[0]!;
    expect(raj.segmentKm).toBe(498);
    expect(raj.stopsCount).toBe(3);
    expect(raj.registrationNumber).toBe("TN 37 XX 4587");
    expect(raj.pricing.transportationCharge).toBe(4500);
  });

  it("never offers vehicles with insufficient capacity", () => {
    const { offers } = searchOffers(db, { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 2500, pickupDate: tomorrow }, { now: NOW });
    expect(offers.map((o) => o.businessName)).toEqual(["Kavin Logistics"]);
  });

  it("driver dashboard: ₹28,500 · +12% · 03 · 05 · 18 · 2,000 kg", () => {
    expect(driverDashboardStats(db, "drv_ravi", NOW)).toEqual({
      earningsThisMonth: 28500,
      changePctVsLastMonth: 12,
      activeRoutes: 3,
      pendingRequests: 5,
      completedTrips: 18,
      nextRouteAvailableCapacityKg: 2000,
    });
  });

  it("earnings: available ₹28,500 · last month ₹25,400 · total ₹1,86,200", () => {
    const e = earningsSummary(db, "drv_ravi", NOW);
    expect([e.availableForPayout, e.thisMonth, e.lastMonth, e.total]).toEqual([28500, 28500, 25400, 186200]);
    expect(e.monthlySeries).toHaveLength(6);
  });

  it("booking requests and the in-transit booking match the contract", () => {
    expect(db.bookings["TAKI874640"]!.pricing.transportationCharge).toBe(4194);
    expect(db.bookings["TAKI874636"]!.pricing.transportationCharge).toBe(4028);
    expect(db.bookings["TAKI874523"]!.status).toBe("in_transit");
    expect(db.bookings["TAKI874523"]!.pricing.totalPayable).toBe(4850);
    expect(db.bookings["TAKI874391"]!.pricing.transportationCharge).toBe(6226);
    for (const b of Object.values(db.bookings)) for (const e of b.statusHistory) expect(Date.parse(e.at)).toBeLessThanOrEqual(NOW.getTime());
  });

  it("capacity invariant holds for the seed", () => {
    expect(capacityInvariantHolds(db)).toBe(true);
  });

  it("works on the 1st of a month just after midnight (no future history)", () => {
    const early = new Date("2026-11-30T18:40:00.000Z"); // 1 Dec 00:10 IST
    const d = buildSeed(early);
    for (const b of Object.values(d.bookings)) for (const e of b.statusHistory) expect(Date.parse(e.at)).toBeLessThanOrEqual(early.getTime());
    expect(earningsSummary(d, "drv_ravi", early).thisMonth).toBe(28500);
  });
});
