"use client";

import { routeCityIds } from "@/lib/domain/search";
import type { Booking, BookingStatus, CityId, Payment, Route } from "@/lib/domain/types";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useBooking, useSession, type BookingDetails } from "@/lib/store/selectors";

/**
 * The booking if it exists AND belongs to the signed-in customer; otherwise null.
 * Callers show the same "not found" state for both cases, so whether another
 * customer's booking exists is never revealed.
 */
export function useOwnedBooking(id: string | null | undefined): { ready: boolean; details: BookingDetails | null } {
  const hydrated = useHydrated();
  const { session } = useSession();
  const details = useBooking(id ?? null);
  const ready = hydrated;
  if (!ready || !details || !session || session.role !== "customer") return { ready, details: null };
  if (details.booking.customerId !== session.profileId) return { ready, details: null };
  return { ready, details };
}

/** Statuses where the customer still has to pay (the driver has accepted). */
export const PAYABLE_STATUSES: readonly BookingStatus[] = ["pending_payment", "payment_failed"];

/** Statuses reached only after a successful payment. */
export const PAID_STATUSES: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];

export const TERMINAL_STATUSES: readonly BookingStatus[] = ["delivered", "declined", "cancelled"];

/** The payment that paid for this booking (succeeded, or later refunded). */
export function settledPayment(payments: Payment[]): Payment | undefined {
  return payments.find((p) => p.status === "succeeded") ?? payments.find((p) => p.status === "refunded");
}

/** Pickup → drop city ids along the route, including the stops in between. */
export function shipmentPath(booking: Booking, route: Route | undefined): CityId[] {
  const { sourceCityId: src, destinationCityId: dst } = booking.shipment;
  if (!route) return [src, dst];
  const ids = routeCityIds(route);
  const a = ids.indexOf(src);
  const b = ids.indexOf(dst);
  return a >= 0 && b > a ? ids.slice(a, b + 1) : [src, dst];
}
