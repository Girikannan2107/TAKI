import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/data/seed";
import * as cmd from "@/lib/domain/commands";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import { DomainError, type CommandContext, type Db } from "@/lib/domain/db";
import { capacityInvariantHolds, earningsSummary } from "@/lib/domain/earnings";

const NOW = new Date("2026-11-10T09:30:00.000Z"); // 15:00 IST
let seed = 1;
const ctx = (): CommandContext => ({ now: NOW, rand: () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) });
const T = todayIst(NOW);
const shipment = { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: addDaysIso(T, 1) };

function fresh(): Db {
  return structuredClone(buildSeed(NOW));
}

describe("customer booking + demo payment", () => {
  it("creates one booking per route+shipment and pays it exactly once", () => {
    const db = fresh();
    const b1 = cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment });
    const b2 = cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment });
    expect(b2.id).toBe(b1.id);
    expect(b1.status).toBe("pending_payment");
    expect(b1.pricing.totalPayable).toBe(4850);

    const pay = (key: string) => cmd.recordPayment(db, ctx(), { customerId: "cus_arjun", bookingId: b1.id, method: "upi", idempotencyKey: key, outcome: "succeeded", mode: "demo" });
    const p1 = pay("k1");
    const p1again = pay("k1");
    const p2 = pay("k2");
    expect(p1again.id).toBe(p1.id);
    expect(p2.id).toBe(p1.id);
    expect(Object.values(db.payments).filter((p) => p.bookingId === b1.id)).toHaveLength(1);
    expect(db.bookings[b1.id]!.status).toBe("awaiting_driver");
    expect(p1.amount).toBe(4850);
  });

  it("rejects bookings that exceed capacity, past dates and same cities", () => {
    const db = fresh();
    expect(() => cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment: { ...shipment, weightKg: 2500 } })).toThrow(DomainError);
    expect(() => cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment: { ...shipment, pickupDate: addDaysIso(T, -1) } })).toThrow(/past/);
    expect(() => cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment: { ...shipment, destinationCityId: "coimbatore" } })).toThrow(/different/);
  });

  it("failed demo payment can be retried", () => {
    const db = fresh();
    const b = cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment });
    cmd.recordPayment(db, ctx(), { customerId: "cus_arjun", bookingId: b.id, method: "card", idempotencyKey: "f1", outcome: "failed", mode: "demo" });
    expect(db.bookings[b.id]!.status).toBe("payment_failed");
    cmd.recordPayment(db, ctx(), { customerId: "cus_arjun", bookingId: b.id, method: "upi", idempotencyKey: "f2", outcome: "succeeded", mode: "demo" });
    expect(db.bookings[b.id]!.status).toBe("awaiting_driver");
  });
});

describe("driver requests and capacity", () => {
  it("accept deducts capacity once; decline never changes it; overbooking is refused", () => {
    const db = fresh();
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(2000);
    cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" }); // 300 kg
    cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" }); // duplicate tap
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(1700);
    cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874636" }); // 1,000 kg
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(700);
    expect(() => cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874631" })).toThrow("Not enough capacity — 700 kg left, needs 1,200 kg");
    cmd.declineBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874631" });
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(700);
    expect(Object.values(db.payments).find((p) => p.bookingId === "TAKI874631")!.status).toBe("refunded");
    expect(() => cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874631" })).toThrow(DomainError);
    expect(capacityInvariantHolds(db)).toBe(true);
  });

  it("other drivers cannot act on Ravi's requests", () => {
    const db = fresh();
    expect(() => cmd.acceptBooking(db, ctx(), { driverId: "drv_sree", bookingId: "TAKI874640" })).toThrow(/another driver/);
  });

  it("delivery credits earnings; customer cancellation releases capacity", () => {
    const db = fresh();
    const before = earningsSummary(db, "drv_ravi", NOW).thisMonth;
    for (let i = 0; i < 2; i++) cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874523", by: "driver", driverId: "drv_ravi" });
    expect(db.bookings["TAKI874523"]!.status).toBe("delivered");
    expect(earningsSummary(db, "drv_ravi", NOW).thisMonth).toBe(before + 4500);

    cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" });
    cmd.cancelBooking(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" });
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(2000);
    expect(capacityInvariantHolds(db)).toBe(true);
  });

  it("simulateNextUpdate accepts then advances through the same rules", () => {
    const db = fresh();
    expect(cmd.simulateNextUpdate(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" }).status).toBe("confirmed");
    expect(cmd.simulateNextUpdate(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" }).status).toBe("picked_up");
    expect(() => cmd.simulateNextUpdate(db, ctx(), { customerId: "cus_meera", bookingId: "TAKI874640" })).toThrow(/another account/);
  });
});

describe("route publishing", () => {
  const draft = {
    originCityId: "coimbatore",
    destinationCityId: "chennai",
    stopCityIds: ["salem", "vellore"],
    travelDate: addDaysIso(T, 5),
    departureTime: "08:00",
    vehicleId: "veh_raj",
    totalCapacityKg: 3000,
    offeredCapacityKg: 2000,
    ratePerKmPaise: 1200,
    ratePerKgPaise: 50,
  };

  it("publishes a valid route with computed distance and it becomes searchable", () => {
    const db = fresh();
    const r = cmd.publishRoute(db, ctx(), { driverId: "drv_ravi", draft });
    expect(r.distanceKm).toBe(498);
    expect(r.stops.map((s) => s.kmFromOrigin)).toEqual([165, 370]);
    expect(r.availableCapacityKg).toBe(2000);
    expect(r.status).toBe("published");
  });

  it.each([
    [{ destinationCityId: "coimbatore" }, /different/],
    [{ offeredCapacityKg: 3500 }, /can't exceed total/],
    [{ totalCapacityKg: 9000 }, /vehicle's/],
    [{ totalCapacityKg: -5 }, /at least 100/],
    [{ travelDate: addDaysIso(T, -1) }, /past/],
    [{ departureTime: undefined }, /departure time/],
    [{ ratePerKmPaise: -100 }, /between ₹1 and ₹100/],
    [{ stopCityIds: ["chennai"] }, /Stops/],
    [{ vehicleId: "veh_sree" }, /your vehicles/],
  ])("rejects invalid draft %o", (patch, msg) => {
    const db = fresh();
    expect(() => cmd.publishRoute(db, ctx(), { driverId: "drv_ravi", draft: { ...draft, ...patch } })).toThrow(msg);
  });

  it("creates a vehicle for a new driver choosing a model", () => {
    const db = fresh();
    const r = cmd.publishRoute(db, ctx(), { driverId: "drv_sree", draft: { ...draft, vehicleId: "new:tata_ace", totalCapacityKg: 700, offeredCapacityKg: 500 } });
    expect(db.vehicles[r.vehicleId]!.modelId).toBe("tata_ace");
  });
});

describe("payouts (demo)", () => {
  it("withdraws within balance, idempotently", () => {
    const db = fresh();
    cmd.requestPayout(db, ctx(), { driverId: "drv_ravi", amount: 10000, idempotencyKey: "w1" });
    cmd.requestPayout(db, ctx(), { driverId: "drv_ravi", amount: 10000, idempotencyKey: "w1" });
    expect(earningsSummary(db, "drv_ravi", NOW).availableForPayout).toBe(18500);
    expect(() => cmd.requestPayout(db, ctx(), { driverId: "drv_ravi", amount: 99999, idempotencyKey: "w2" })).toThrow(/available balance/);
    expect(() => cmd.requestPayout(db, ctx(), { driverId: "drv_ravi", amount: 50, idempotencyKey: "w3" })).toThrow(/Minimum/);
  });
});

describe("pickup date guard", () => {
  it("drivers can't mark pickup before the travel date; demo simulation is exempt", () => {
    const db = fresh();
    expect(() => cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874611", by: "driver", driverId: "drv_ravi" })).toThrow(/Pickup can be marked from/);
    expect(cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874611", by: "system" }).status).toBe("picked_up");
    expect(cmd.canMarkPickedUp(db.bookings["TAKI874523"]!, NOW)).toBe(true);
  });
});

describe("expireDepartedRequests (data-contract §4 #10)", () => {
  it("auto-declines and refunds requests whose route has departed; idempotent", () => {
    const db = fresh();
    // Departure of rte_r1 is tomorrow 08:00 IST; jump past it.
    const later: CommandContext = { now: new Date(Date.parse(`${addDaysIso(T, 1)}T09:00:00+05:30`)), rand: Math.random };
    const changed = cmd.expireDepartedRequests(db, later);
    expect(changed).toEqual(expect.arrayContaining(["TAKI874640", "TAKI874636", "TAKI874631"]));
    expect(db.bookings["TAKI874640"]!.status).toBe("declined");
    expect(db.bookings["TAKI874640"]!.cancelReason).toBe("route_departed");
    expect(Object.values(db.payments).find((p) => p.bookingId === "TAKI874640")!.status).toBe("refunded");
    expect(db.bookings["TAKI874611"]!.status).toBe("confirmed"); // accepted bookings untouched
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(2000); // capacity unchanged
    expect(cmd.expireDepartedRequests(db, later)).toEqual([]);
    expect(capacityInvariantHolds(db)).toBe(true);
  });

  it("does nothing before departure", () => {
    expect(cmd.expireDepartedRequests(fresh(), ctx())).toEqual([]);
  });
});
