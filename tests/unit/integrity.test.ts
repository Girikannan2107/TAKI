/**
 * T5 integrity tests — gaps not covered by commands/booking-machine tests:
 * webhook signature + replay window, booking id / idempotency key validation,
 * cross-account access, terminal-state rejections, double publish, and
 * capacity invariants under a mixed accept/decline/cancel sequence.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isBookingId,
  isFreshTimestamp,
  isIdempotencyKey,
  verifyWebhookSignature,
} from "@/app/api/payments/cashfree/_lib/cashfree-server";
import { buildSeed } from "@/lib/data/seed";
import { transition } from "@/lib/domain/booking-machine";
import * as cmd from "@/lib/domain/commands";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import { DomainError, type CommandContext, type Db } from "@/lib/domain/db";
import { capacityInvariantHolds } from "@/lib/domain/earnings";

const NOW = new Date("2026-11-10T09:30:00.000Z"); // 15:00 IST
let seed = 7;
const ctx = (now: Date = NOW): CommandContext => ({ now, rand: () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) });
const T = todayIst(NOW);
const shipment = { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: addDaysIso(T, 1) };
const fresh = (): Db => structuredClone(buildSeed(NOW));

describe("Cashfree webhook signature (server helper)", () => {
  const secret = "test_secret_value";
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"o1"}}}';
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sign = (t: string, b: string, s = secret) => createHmac("sha256", s).update(t + b, "utf8").digest("base64");

  it("accepts a correct HMAC-SHA256(timestamp + rawBody) signature", () => {
    expect(verifyWebhookSignature({ timestamp: ts, rawBody: body, signature: sign(ts, body), secret })).toBe(true);
  });

  it.each([
    ["missing signature", { signature: null }],
    ["missing timestamp", { timestamp: null }],
    ["empty secret", { secret: "" }],
    ["garbage signature", { signature: "not-base64!!" }],
    ["truncated signature", { signature: "AAAA" }],
    ["signature made with another secret", { signature: sign(ts, body, "other") }],
    ["tampered body", { rawBody: body.replace("o1", "o2") }],
    ["different timestamp", { timestamp: String(Number(ts) + 1) }],
  ])("rejects %s", (_name, patch) => {
    const input = { timestamp: ts, rawBody: body, signature: sign(ts, body), secret, ...patch };
    expect(verifyWebhookSignature(input as Parameters<typeof verifyWebhookSignature>[0])).toBe(false);
  });

  it("enforces a ±5 minute replay window (seconds or ms)", () => {
    const now = NOW.getTime();
    expect(isFreshTimestamp(String(Math.floor(now / 1000)), now)).toBe(true);
    expect(isFreshTimestamp(String(now), now)).toBe(true);
    expect(isFreshTimestamp(String(Math.floor(now / 1000) - 301), now)).toBe(false);
    expect(isFreshTimestamp(String(Math.floor(now / 1000) + 301), now)).toBe(false);
    expect(isFreshTimestamp("abc", now)).toBe(false);
    expect(isFreshTimestamp(null, now)).toBe(false);
  });

  it("validates booking ids and idempotency keys strictly", () => {
    expect(isBookingId("TAKI874523")).toBe(true);
    expect(isBookingId("TAKI87452")).toBe(false);
    expect(isBookingId("TAKI874523; drop")).toBe(false);
    expect(isIdempotencyKey("pay_TAKI874523_0b7e2c1a-6a3e-4c1d-9d55-1f0c9c1d2e3f")).toBe(true);
    expect(isIdempotencyKey("short")).toBe(false);
    expect(isIdempotencyKey("x".repeat(129))).toBe(false);
    expect(isIdempotencyKey("pay/../../etc")).toBe(false);
  });
});

describe("cross-account and terminal-state protections", () => {
  it("a customer cannot pay or cancel another customer's booking", () => {
    const db = fresh();
    const b = cmd.createBookingForPayment(db, ctx(), { customerId: "cus_arjun", routeId: "rte_r1", shipment });
    expect(() =>
      cmd.recordPayment(db, ctx(), { customerId: "cus_meera", bookingId: b.id, method: "upi", idempotencyKey: "x1", outcome: "succeeded", mode: "demo" }),
    ).toThrow(/another account/);
    expect(() => cmd.cancelBooking(db, ctx(), { customerId: "cus_meera", bookingId: b.id })).toThrow(/another account/);
    expect(db.bookings[b.id]!.status).toBe("pending_payment");
  });

  it("a declined booking cannot be paid, accepted or cancelled; decline is idempotent", () => {
    const db = fresh();
    cmd.declineBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" });
    const again = cmd.declineBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" });
    expect(again.statusHistory.filter((e) => e.status === "declined")).toHaveLength(1);
    expect(() => cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: "TAKI874640" })).toThrow(DomainError);
    expect(() => cmd.cancelBooking(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" })).toThrow(DomainError);
    expect(() =>
      cmd.recordPayment(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640", method: "upi", idempotencyKey: "late", outcome: "succeeded", mode: "demo" }),
    ).toThrow(/can't be paid/);
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(2000);
  });

  it("customer cancelling an awaiting_driver booking refunds without touching capacity; withdrawal is derived", () => {
    const db = fresh();
    const before = db.routes["rte_r1"]!.availableCapacityKg;
    const b = cmd.cancelBooking(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" });
    expect(b.status).toBe("cancelled");
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(before);
    expect(Object.values(db.payments).find((p) => p.bookingId === "TAKI874640")!.status).toBe("refunded");
    // cancel is idempotent
    expect(cmd.cancelBooking(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874640" }).statusHistory).toHaveLength(b.statusHistory.length);
  });

  it("delivered is terminal: no further advance, cancel or simulate", () => {
    const db = fresh();
    cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874523", by: "system" });
    cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874523", by: "system" });
    expect(db.bookings["TAKI874523"]!.status).toBe("delivered");
    const earnings = Object.keys(db.earnings).length;
    expect(() => cmd.advanceShipment(db, ctx(), { bookingId: "TAKI874523", by: "system" })).toThrow(DomainError);
    expect(() => cmd.cancelBooking(db, ctx(), { customerId: "cus_arjun", bookingId: "TAKI874523" })).toThrow(DomainError);
    expect(Object.keys(db.earnings)).toHaveLength(earnings); // delivery credited exactly once
  });

  it("the state machine appends exactly one status event per transition", () => {
    const db = fresh();
    const b = db.bookings["TAKI874640"]!;
    const n = b.statusHistory.length;
    const c = transition(b, "accept", { at: NOW.toISOString(), by: "driver" });
    expect(c.statusHistory).toHaveLength(n + 1);
    expect(transition(c, "accept", { at: NOW.toISOString(), by: "driver" }).statusHistory).toHaveLength(n + 1);
  });
});

describe("double submission at the command layer", () => {
  it("publishing the same draft twice yields one route (second attempt refused, not duplicated)", () => {
    const db = fresh();
    const draft = {
      originCityId: "coimbatore",
      destinationCityId: "chennai",
      stopCityIds: [],
      travelDate: addDaysIso(T, 6),
      departureTime: "08:00",
      vehicleId: "veh_raj",
      totalCapacityKg: 3000,
      offeredCapacityKg: 2000,
      ratePerKmPaise: 1200,
      ratePerKgPaise: 50,
    };
    const before = Object.keys(db.routes).length;
    cmd.publishRoute(db, ctx(), { driverId: "drv_ravi", draft });
    expect(() => cmd.publishRoute(db, ctx(), { driverId: "drv_ravi", draft })).toThrow(/already has a published route/);
    expect(Object.keys(db.routes)).toHaveLength(before + 1);
  });

  it("capacity never goes negative across a mixed accept/decline/cancel sequence", () => {
    const db = fresh();
    const pending = Object.values(db.bookings).filter((b) => b.routeId === "rte_r1" && b.status === "awaiting_driver").map((b) => b.id);
    expect(pending.length).toBeGreaterThan(0);
    for (const id of pending) {
      try {
        cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: id });
        cmd.acceptBooking(db, ctx(), { driverId: "drv_ravi", bookingId: id });
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
      }
      expect(db.routes["rte_r1"]!.availableCapacityKg).toBeGreaterThanOrEqual(0);
      expect(capacityInvariantHolds(db)).toBe(true);
    }
    const confirmed = Object.values(db.bookings).filter((b) => b.routeId === "rte_r1" && b.status === "confirmed");
    for (const b of confirmed) cmd.cancelBooking(db, ctx(), { customerId: b.customerId, bookingId: b.id });
    expect(db.routes["rte_r1"]!.availableCapacityKg).toBe(db.routes["rte_r1"]!.offeredCapacityKg);
    expect(capacityInvariantHolds(db)).toBe(true);
  });
});

describe("data-contract §4 #10 — route departs while a request is pending", () => {
  // Defect S-02: no command applies the `routeDeparted` event. After departure the
  // request stays `awaiting_driver` (pending) forever, Accept throws "departed",
  // and the customer's demo payment is never refunded unless they cancel manually.
  it("after departure, Accept is refused and the request is still pending (documents current behaviour)", () => {
    const db = fresh();
    const route = db.routes["rte_r1"]!;
    const after = new Date(Date.parse(`${route.travelDate}T${route.departureTime}:00+05:30`) + 60 * 60_000);
    expect(() => cmd.acceptBooking(db, ctx(after), { driverId: "drv_ravi", bookingId: "TAKI874640" })).toThrow(/departed/);
    expect(db.bookings["TAKI874640"]!.status).toBe("awaiting_driver");
  });
  it.todo("S-02: pending requests are auto-declined (reason route_departed) and refunded once the route departs");
});
