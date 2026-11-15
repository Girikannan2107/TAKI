import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/api/contracts/errors";
import { AddressSchema, IdSchema, PhoneSchema } from "@/lib/api/contracts/common";
import { applyEvent, HOLDING_STATUSES, tabOf, type MachineBooking } from "@/lib/domain/booking-machine";
import { capacityInvariant, effectiveAvailableKg, fits } from "@/lib/domain/capacity";
import { bookingIdCandidates, newId } from "@/lib/domain/ids";
import { BOOKING_STATUSES, STATE_CODES } from "@/lib/domain/model";
import { cumulativeKm, DISTRICTS, districtsInState, getPlace, isKmOverrideAllowed, legKm, nearestDistrict, PLACES, pincodeMatchesState } from "@/lib/domain/places";
import { quoteV2 } from "@/lib/domain/pricing";
import { goodsProblem, locateSegment, pickupKeysFor } from "@/lib/domain/segments";

const T0 = "2026-11-13T06:00:00.000Z";
const sys = { role: "system" as const, userId: null };
const mk = (status: MachineBooking["status"]): MachineBooking => ({ status, tab: tabOf(status), statusHistory: [], updatedAt: T0, version: 1 });

describe("booking machine v2", () => {
  it("walks the happy path and keeps tab + history in sync", () => {
    let b = mk("awaiting_agency");
    for (const e of ["accept", "paymentSucceeded", "pickup", "startTransit", "outForDelivery", "deliver"] as const) {
      const r = applyEvent(b, e, { at: T0, by: sys });
      expect(r.changed).toBe(true);
      b = r.booking;
    }
    expect(b.status).toBe("delivered");
    expect(b.tab).toBe("delivered");
    expect(b.statusHistory.map((h) => h.status)).toEqual(["pending_payment", "confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"]);
    expect(b.version).toBe(7);
  });

  it("is idempotent when already in the target state", () => {
    const r = applyEvent(mk("pending_payment"), "accept", { at: T0, by: sys });
    expect(r.changed).toBe(false);
    expect(r.booking.version).toBe(1);
  });

  it("rejects impossible transitions with invalid_transition (409)", () => {
    expect(() => applyEvent(mk("picked_up"), "cancel", { at: T0, by: sys })).toThrowError(DomainError);
    let caught: DomainError | null = null;
    try {
      applyEvent(mk("delivered"), "accept", { at: T0, by: sys });
    } catch (e) {
      caught = e as DomainError;
    }
    expect(caught?.code).toBe("invalid_transition");
    expect(caught?.status).toBe(409);
  });

  it("trip cancellation rejects requests but cancels accepted bookings", () => {
    expect(applyEvent(mk("awaiting_agency"), "tripCancelled", { at: T0, by: sys }).booking.status).toBe("rejected");
    expect(applyEvent(mk("confirmed"), "tripCancelled", { at: T0, by: sys }).booking.status).toBe("cancelled");
  });

  it("maps every status to a customer tab", () => {
    for (const s of BOOKING_STATUSES) expect(tabOf(s)).toBeTruthy();
    expect(tabOf("out_for_delivery")).toBe("in_transit");
    expect(tabOf("payment_failed")).toBe("pending");
  });
});

describe("capacity ledger", () => {
  const trip = {
    capacity: { vehicleMaxKg: 3000, offeredKg: 1000 },
    holds: {
      TAKI100001: { kg: 300, kind: "paid" as const, dueAt: null },
      TAKI100002: { kg: 200, kind: "unpaid" as const, dueAt: "2026-11-13T07:00:00.000Z" },
      TAKI100003: { kg: 400, kind: "unpaid" as const, dueAt: "2026-11-13T05:00:00.000Z" }, // expired
    },
  };
  it("ignores expired unpaid holds instantly", () => {
    expect(effectiveAvailableKg(trip, T0)).toBe(500);
    expect(effectiveAvailableKg(trip, "2026-11-13T08:00:00.000Z")).toBe(700);
    expect(fits(trip, 500, T0)).toBe(true);
    expect(fits(trip, 501, T0)).toBe(false);
  });
  it("reports invariant violations", () => {
    const ok = capacityInvariant(
      trip,
      [
        { id: "TAKI100001", status: "confirmed", weightKg: 300 },
        { id: "TAKI100002", status: "pending_payment", weightKg: 200 },
        { id: "TAKI100003", status: "payment_failed", weightKg: 400 },
      ],
      T0,
    );
    expect(ok).toEqual([]);
    const bad = capacityInvariant(trip, [{ id: "TAKI100001", status: "cancelled", weightKg: 300 }], T0);
    expect(bad.length).toBeGreaterThan(0);
    expect(HOLDING_STATUSES).toContain("delivered");
  });
});

describe("pricing v2", () => {
  it("itemises lines that add up exactly", () => {
    const q = quoteV2({ segmentKm: 498, weightKg: 500, ratePerKmPaise: 750, ratePerKgPaise: 153, handlingFeeRupees: 200, specialHandling: ["fragile"] });
    expect([q.distanceCharge, q.weightCharge, q.handlingFee, q.serviceFee]).toEqual([3735, 765, 200, 350]);
    expect(q.totalPayable).toBe(5050);
    expect(q.lines.reduce((s, l) => s + l.amount, 0)).toBe(q.totalPayable);
  });
  it("charges handling only when special handling is requested", () => {
    const q = quoteV2({ segmentKm: 100, weightKg: 100, ratePerKmPaise: 1000, ratePerKgPaise: 100, handlingFeeRupees: 300, specialHandling: [] });
    expect(q.handlingFee).toBe(0);
    expect(q.lines.map((l) => l.code)).toEqual(["distance", "weight", "service_fee"]);
  });
});

describe("places dataset", () => {
  it("has 142 districts with the expected per-state counts", () => {
    expect(DISTRICTS).toHaveLength(142);
    const counts = Object.fromEntries(STATE_CODES.map((s) => [s, districtsInState(s).length]));
    expect(counts).toEqual({ TN: 38, KL: 14, KA: 31, TG: 33, AP: 26 });
    expect(new Set(DISTRICTS.map((d) => d.id)).size).toBe(142);
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
  });
  it("keeps Phase 1 city ids as places in the right districts", () => {
    expect(getPlace("hosur")?.districtId).toBe("krishnagiri");
    expect(getPlace("bengaluru")?.districtId).toBe("bengaluru-urban");
    expect(getPlace("kochi")?.districtId).toBe("ernakulam");
    for (const id of ["coimbatore", "tiruppur", "erode", "salem", "namakkal", "krishnagiri", "vellore", "kanchipuram", "chennai", "madurai", "tiruchirappalli"])
      expect(getPlace(id)?.districtId).toBe(id);
  });
  it("uses curated legs and approximates others", () => {
    expect(legKm("coimbatore", "chennai")).toBe(498);
    expect(cumulativeKm(["coimbatore", "salem", "vellore", "chennai"])).toEqual([0, 165, 370, 498]);
    expect(legKm("madurai", "thoothukudi")).toBeGreaterThan(100);
    expect(isKmOverrideAllowed(100, 129)).toBe(true);
    expect(isKmOverrideAllowed(100, 131)).toBe(false);
  });
  it("validates pincode against state and finds the nearest district", () => {
    expect(pincodeMatchesState("641001", "TN")).toBe(true);
    expect(pincodeMatchesState("560001", "TN")).toBe(false);
    expect(pincodeMatchesState("500001", "TG")).toBe(true);
    expect(nearestDistrict(11.02, 76.96)?.id).toBe("coimbatore");
    expect(nearestDistrict(28.6, 77.2)).toBeNull(); // Delhi: outside service area
  });
});

describe("segments & goods", () => {
  const cps = [{ districtId: "coimbatore" }, { districtId: "salem" }, { districtId: "vellore" }, { districtId: "chennai" }];
  it("finds pickup/drop in route order only", () => {
    expect(locateSegment(cps, "salem", "chennai")).toEqual({ pickupIndex: 1, dropIndex: 3 });
    expect(locateSegment(cps, "chennai", "salem")).toBeNull();
    expect(locateSegment(cps, "salem", "salem")).toBeNull();
  });
  it("builds pickup keys excluding the destination", () => {
    const keys = pickupKeysFor(
      [
        { districtId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: "2026-11-14T00:30:00.000Z" },
        { districtId: "salem", expectedArrivalAt: "2026-11-14T03:30:00.000Z", expectedDepartureAt: "2026-11-14T19:00:00.000Z" },
        { districtId: "chennai", expectedArrivalAt: "2026-11-15T01:00:00.000Z", expectedDepartureAt: null },
      ],
      "2026-11-14T00:30:00.000Z",
    );
    expect(keys).toEqual(["coimbatore|2026-11-14", "salem|2026-11-15"]); // 19:00Z = 00:30 IST next day
  });
  it("applies goods rules", () => {
    const g = { accepted: ["general_goods" as const], handlingSupported: [], maxPackageKg: 500 };
    expect(goodsProblem(g, { goodsCategory: "general_goods", specialHandling: ["fragile"], weightKg: 100 })).toBeNull();
    expect(goodsProblem(g, { goodsCategory: "perishables", specialHandling: [], weightKg: 100 })).toBe("goods_not_accepted");
    expect(goodsProblem(g, { goodsCategory: "general_goods", specialHandling: ["temperature_sensitive"], weightKg: 100 })).toBe("handling_not_supported");
    expect(goodsProblem(g, { goodsCategory: "general_goods", specialHandling: [], weightKg: 600 })).toBe("package_too_heavy");
  });
});

describe("ids & contracts", () => {
  it("generates ids matching IdSchema and booking ids", () => {
    const id = newId("trp");
    expect(IdSchema("trp").safeParse(id).success).toBe(true);
    expect(bookingIdCandidates(3).every((b) => /^TAKI\d{6}$/.test(b))).toBe(true);
  });
  it("normalises phones and checks address district/pincode against state", () => {
    expect(PhoneSchema.parse("98765 43210")).toBe("+919876543210");
    const base = { line1: "12 Main Road", districtId: "coimbatore", state: "TN", pincode: "641001", source: "manual" } as const;
    expect(AddressSchema.safeParse(base).success).toBe(true);
    expect(AddressSchema.safeParse({ ...base, state: "KL" }).success).toBe(false);
    expect(AddressSchema.safeParse({ ...base, pincode: "560001" }).success).toBe(false);
  });
});
