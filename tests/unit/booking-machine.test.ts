import { describe, expect, it } from "vitest";
import { InvalidTransitionError, requestStatusOf, transition } from "@/lib/domain/booking-machine";
import type { Booking } from "@/lib/domain/types";

const base: Booking = {
  id: "TAKI100000",
  customerId: "c",
  driverId: "d",
  routeId: "r",
  vehicleId: "v",
  shipment: { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: "2026-11-11" },
  pricing: {
    pricingVersion: 1,
    distanceKm: 498,
    weightKg: 500,
    ratePerKmPaise: 750,
    ratePerKgPaise: 153,
    distanceCharge: 3735,
    weightCharge: 765,
    transportationCharge: 4500,
    serviceFee: 350,
    totalPayable: 4850,
  },
  status: "draft",
  statusHistory: [],
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
};
const ctx = { at: "2026-11-10T01:00:00.000Z", by: "system" as const };

describe("booking state machine", () => {
  it("follows the happy path to delivered", () => {
    let b = base;
    for (const e of ["bookThisVehicle", "paymentSucceeded", "accept", "markPickedUp", "startTransit", "markOutForDelivery", "markDelivered"] as const)
      b = transition(b, e, ctx);
    expect(b.status).toBe("delivered");
    expect(b.statusHistory.map((h) => h.status)).toEqual([
      "pending_payment",
      "awaiting_driver",
      "confirmed",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
  });

  it("rejects invalid transitions", () => {
    expect(() => transition(base, "accept", ctx)).toThrow(InvalidTransitionError);
    expect(() => transition({ ...base, status: "declined" }, "accept", ctx)).toThrow(InvalidTransitionError);
    expect(() => transition({ ...base, status: "delivered" }, "cancel", ctx)).toThrow(InvalidTransitionError);
  });

  it("is idempotent for repeated events", () => {
    const confirmed = { ...base, status: "confirmed" as const };
    expect(transition(confirmed, "accept", ctx)).toBe(confirmed);
  });

  it("supports payment failure and retry", () => {
    let b = transition(base, "bookThisVehicle", ctx);
    b = transition(b, "paymentFailed", ctx);
    expect(b.status).toBe("payment_failed");
    b = transition(b, "retryPayment", ctx);
    expect(transition(b, "paymentSucceeded", ctx).status).toBe("awaiting_driver");
  });

  it("derives request status", () => {
    expect(requestStatusOf({ ...base, status: "awaiting_driver" })).toBe("pending");
    expect(requestStatusOf({ ...base, status: "in_transit" })).toBe("accepted");
    expect(requestStatusOf({ ...base, status: "declined" })).toBe("declined");
    expect(requestStatusOf({ ...base, status: "cancelled", statusHistory: [{ status: "awaiting_driver", at: ctx.at, by: "system" }] })).toBe("withdrawn");
    expect(requestStatusOf({ ...base, status: "pending_payment" })).toBeNull();
  });
});
