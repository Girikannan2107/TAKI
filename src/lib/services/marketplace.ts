"use client";
/**
 * Marketplace service — the ONLY way UI code changes business data.
 * Async (with small demo latency) so a Firebase/Cloud Functions implementation
 * can replace the bodies without touching call sites. All methods throw
 * DomainError with a user-facing `message` on failure.
 */
import * as cmd from "@/lib/domain/commands";
import { DomainError } from "@/lib/domain/db";
import type { Booking, BookingId, Payout, Route, RouteDraft, Shipment } from "@/lib/domain/types";
import { useTakiStore } from "@/lib/store";

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function requireRole(role: "customer" | "driver"): string {
  const { session } = useTakiStore.getState();
  if (!session || session.role !== role)
    throw new DomainError("not_signed_in", role === "customer" ? "Sign in as a customer to continue." : "Sign in as a driver to continue.");
  return session.profileId;
}

const inFlight = new Map<string, Promise<unknown>>();
/** Collapse concurrent identical calls (double-click safety). */
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export const marketplace = {
  /** "Request Booking": creates (or reuses) a request awaiting the partner's acceptance. Nothing is paid yet. */
  requestBooking(routeId: string, shipment: Shipment): Promise<Booking> {
    return once(`book:${routeId}:${JSON.stringify(shipment)}`, async () => {
      const customerId = requireRole("customer");
      await delay();
      return useTakiStore.getState().mutate((db, ctx) => cmd.requestBooking(db, ctx, { customerId, routeId, shipment }));
    });
  },

  cancelBooking(bookingId: BookingId): Promise<Booking> {
    return once(`cancel:${bookingId}`, async () => {
      const customerId = requireRole("customer");
      await delay();
      return useTakiStore.getState().mutate((db, ctx) => cmd.cancelBooking(db, ctx, { customerId, bookingId }));
    });
  },

  /** DEMO: advance a shipment one step (labelled as a simulation in the UI). */
  simulateNextUpdate(bookingId: BookingId): Promise<Booking> {
    return once(`sim:${bookingId}`, async () => {
      const customerId = requireRole("customer");
      await delay(500);
      return useTakiStore.getState().mutate((db, ctx) => cmd.simulateNextUpdate(db, ctx, { customerId, bookingId }));
    });
  },

  acceptRequest(bookingId: BookingId): Promise<Booking> {
    return once(`accept:${bookingId}`, async () => {
      const driverId = requireRole("driver");
      await delay();
      return useTakiStore.getState().mutate((db, ctx) => cmd.acceptBooking(db, ctx, { driverId, bookingId }));
    });
  },

  declineRequest(bookingId: BookingId): Promise<Booking> {
    return once(`decline:${bookingId}`, async () => {
      const driverId = requireRole("driver");
      await delay();
      return useTakiStore.getState().mutate((db, ctx) => cmd.declineBooking(db, ctx, { driverId, bookingId }));
    });
  },

  /** Driver marks pickup / transit / out for delivery / delivered. Pickup and delivery need the customer's OTP. */
  advanceShipment(bookingId: BookingId, otp?: string): Promise<Booking> {
    return once(`advance:${bookingId}`, async () => {
      const driverId = requireRole("driver");
      await delay();
      return useTakiStore.getState().mutate((db, ctx) => cmd.advanceShipment(db, ctx, { bookingId, by: "driver", driverId, otp }));
    });
  },

  /** Publish the route draft. Clears the draft on success. */
  publishRoute(draft: RouteDraft): Promise<Route> {
    return once(`publish:${JSON.stringify(draft)}`, async () => {
      const driverId = requireRole("driver");
      await delay(600);
      const route = useTakiStore.getState().mutate((db, ctx) => cmd.publishRoute(db, ctx, { driverId, draft }));
      useTakiStore.getState().clearRouteDraft();
      return route;
    });
  },

  /** DEMO payout — simulated, no money moves. */
  requestPayout(amount: number, idempotencyKey: string): Promise<Payout> {
    return once(`payout:${idempotencyKey}`, async () => {
      const driverId = requireRole("driver");
      await delay(800);
      return useTakiStore.getState().mutate((db, ctx) => cmd.requestPayout(db, ctx, { driverId, amount, idempotencyKey }));
    });
  },

  async updateCustomerProfile(patch: { fullName: string }): Promise<void> {
    const customerId = requireRole("customer");
    await delay(300);
    useTakiStore.getState().mutate((db) => {
      const c = db.customers[customerId];
      if (!c) throw new DomainError("not_found", "Profile not found.");
      db.customers[customerId] = { ...c, fullName: patch.fullName.trim() };
    });
  },

  async updateDriverProfile(patch: { fullName: string; businessName: string }): Promise<void> {
    const driverId = requireRole("driver");
    await delay(300);
    useTakiStore.getState().mutate((db) => {
      const d = db.drivers[driverId];
      if (!d) throw new DomainError("not_found", "Profile not found.");
      db.drivers[driverId] = { ...d, fullName: patch.fullName.trim(), businessName: patch.businessName.trim() };
    });
  },

  /** Update a driver's vehicle registration ("TN 37 XX 4587" format). */
  async updateVehicleRegistration(vehicleId: string, registrationNumber: string): Promise<void> {
    const driverId = requireRole("driver");
    await delay(300);
    useTakiStore.getState().mutate((db) => {
      const v = db.vehicles[vehicleId];
      if (!v || v.driverId !== driverId) throw new DomainError("not_found", "Vehicle not found.");
      db.vehicles[vehicleId] = { ...v, registrationNumber: registrationNumber.trim().toUpperCase() };
    });
  },
};

/** Extract a user-facing message from any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof DomainError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
