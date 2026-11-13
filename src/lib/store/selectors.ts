"use client";
/**
 * Read hooks. Each selects stable raw slices from the store and derives with
 * useMemo (never return fresh arrays/objects straight from a zustand selector).
 * All hooks are safe before hydration but views should gate on `useHydrated()`.
 */
import { useMemo } from "react";
import { requestStatusOf, isVisibleToDriver } from "@/lib/domain/legacy/booking-machine";
import { cityName } from "@/lib/domain/cities";
import { driverDashboardStats, driverEarningEntries, driverPayouts, earningsSummary } from "@/lib/domain/earnings";
import { offerFromRoute, offerProblem, OFFER_PROBLEM_MESSAGE, searchOffers, type OfferProblem, type SortKey } from "@/lib/domain/search";
import type {
  Booking,
  BookingId,
  BookingRequestStatus,
  Customer,
  Driver,
  Notification,
  Payment,
  Role,
  Route,
  Session,
  Shipment,
  Vehicle,
  VehicleOffer,
} from "@/lib/domain/types";
import { vehicleOptionsFor } from "@/lib/domain/vehicles";
import { firstName as getFirstName } from "@/lib/format";
import { getNow } from "@/lib/utils/clock";
import { useTakiStore } from "./index";

export interface SessionUser {
  name: string;
  firstName: string;
  mobile: string;
  role: Role;
  profileId: string;
}

/** Current session (valid + not expired) and display info for the signed-in user. */
export function useSession(): { hydrated: boolean; session: Session | null; role: Role | null; user: SessionUser | null } {
  const hydrated = useTakiStore((s) => s.hydrated);
  const session = useTakiStore((s) => s.session);
  const db = useTakiStore((s) => s.db);
  return useMemo(() => {
    if (!hydrated || !session) return { hydrated, session: null, role: null, user: null };
    const account = db.accounts[session.accountId];
    const expired = Date.parse(session.expiresAt) <= getNow().getTime();
    if (!account || expired) return { hydrated, session: null, role: null, user: null };
    const profile = session.role === "customer" ? db.customers[session.profileId] : db.drivers[session.profileId];
    const name = profile?.fullName ?? "TAKI user";
    return {
      hydrated,
      session,
      role: session.role,
      user: { name, firstName: getFirstName(name), mobile: account.mobile, role: session.role, profileId: session.profileId },
    };
  }, [hydrated, session, db]);
}

export function useCurrentCustomer(): Customer | null {
  const { session } = useSession();
  const customers = useTakiStore((s) => s.db.customers);
  return session?.role === "customer" ? (customers[session.profileId] ?? null) : null;
}

export function useCurrentDriver(): Driver | null {
  const { session } = useSession();
  const drivers = useTakiStore((s) => s.db.drivers);
  return session?.role === "driver" ? (drivers[session.profileId] ?? null) : null;
}

// ───────────────────────────── Customer ─────────────────────────────

export function useOffers(shipment: Shipment | null, sort: SortKey = "best"): { offers: VehicleOffer[]; excludedForCapacity: number } {
  const db = useTakiStore((s) => s.db);
  return useMemo(() => {
    if (!shipment) return { offers: [], excludedForCapacity: 0 };
    return searchOffers(db, shipment, { now: getNow(), sort });
  }, [db, shipment, sort]);
}

/** The offer for a route + shipment, plus why it can't be booked (if so). */
export function useOffer(
  routeId: string | undefined,
  shipment: Shipment | null,
): { offer: VehicleOffer | null; route: Route | null; vehicle: Vehicle | null; driver: Driver | null; problem: OfferProblem | null; problemMessage: string | null } {
  const db = useTakiStore((s) => s.db);
  return useMemo(() => {
    const route = routeId ? (db.routes[routeId] ?? null) : null;
    const vehicle = route ? (db.vehicles[route.vehicleId] ?? null) : null;
    const driver = route ? (db.drivers[route.driverId] ?? null) : null;
    if (!route || !shipment) {
      const problem: OfferProblem | null = route ? null : "not_found";
      return { offer: null, route, vehicle, driver, problem, problemMessage: problem ? OFFER_PROBLEM_MESSAGE[problem] : null };
    }
    const offer = offerFromRoute(db, route, shipment);
    const problem = offerProblem(db, route, shipment, getNow());
    return { offer, route, vehicle, driver, problem, problemMessage: problem ? OFFER_PROBLEM_MESSAGE[problem] : null };
  }, [db, routeId, shipment]);
}

export interface BookingDetails {
  booking: Booking;
  route: Route | undefined;
  vehicle: Vehicle | undefined;
  driver: Driver | undefined;
  customer: Customer | undefined;
  payments: Payment[];
}

/** A booking with its related records (null if missing). */
export function useBooking(id: BookingId | undefined | null): BookingDetails | null {
  const db = useTakiStore((s) => s.db);
  return useMemo(() => {
    const booking = id ? db.bookings[id] : undefined;
    if (!booking) return null;
    return {
      booking,
      route: db.routes[booking.routeId],
      vehicle: db.vehicles[booking.vehicleId],
      driver: db.drivers[booking.driverId],
      customer: db.customers[booking.customerId],
      payments: Object.values(db.payments)
        .filter((p) => p.bookingId === booking.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }, [db, id]);
}

/** Current customer's bookings, newest first (excludes abandoned drafts). */
export function useCustomerBookings(): BookingDetails[] {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => {
    if (session?.role !== "customer") return [];
    return Object.values(db.bookings)
      .filter((b) => b.customerId === session.profileId && b.status !== "draft")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((booking) => ({
        booking,
        route: db.routes[booking.routeId],
        vehicle: db.vehicles[booking.vehicleId],
        driver: db.drivers[booking.driverId],
        customer: db.customers[booking.customerId],
        payments: Object.values(db.payments).filter((p) => p.bookingId === booking.id),
      }));
  }, [db, session]);
}

/** Current customer's payments, newest first. */
export function useCustomerPayments(): Array<{ payment: Payment; booking: Booking | undefined }> {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => {
    if (session?.role !== "customer") return [];
    return Object.values(db.payments)
      .filter((p) => p.customerId === session.profileId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((payment) => ({ payment, booking: db.bookings[payment.bookingId] }));
  }, [db, session]);
}

// ───────────────────────────── Driver ─────────────────────────────

export interface DriverRequest {
  booking: Booking;
  status: BookingRequestStatus;
  customerName: string;
  route: Route | undefined;
  /** Driver's earnings for this booking (transportation charge). */
  earnings: number;
  /** Capacity left on the route right now. */
  routeAvailableKg: number;
  /** True when accepting would exceed remaining capacity. */
  overCapacity: boolean;
}

/** Booking requests for the signed-in driver, newest first. */
export function useDriverRequests(): DriverRequest[] {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => {
    if (session?.role !== "driver") return [];
    return Object.values(db.bookings)
      .filter((b) => b.driverId === session.profileId && isVisibleToDriver(b.status))
      .map((booking) => {
        const status = requestStatusOf(booking);
        const route = db.routes[booking.routeId];
        const available = route?.availableCapacityKg ?? 0;
        const paidAt = booking.statusHistory.find((e) => e.status === "awaiting_driver")?.at ?? booking.createdAt;
        return {
          booking,
          status: status ?? "withdrawn",
          customerName: db.customers[booking.customerId]?.fullName ?? "Customer",
          route,
          earnings: booking.pricing.transportationCharge,
          routeAvailableKg: available,
          overCapacity: booking.status === "awaiting_driver" && booking.shipment.weightKg > available,
          _sort: paidAt,
        };
      })
      .sort((a, b) => b._sort.localeCompare(a._sort))
      .map(({ _sort, ...rest }) => {
        void _sort;
        return rest;
      });
  }, [db, session]);
}

export interface DriverRouteSummary {
  route: Route;
  vehicle: Vehicle | undefined;
  pathLabel: string;
  pendingRequests: number;
  acceptedBookings: number;
  departed: boolean;
}

/** Signed-in driver's routes (soonest first; completed last). */
export function useDriverRoutes(): DriverRouteSummary[] {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => {
    if (session?.role !== "driver") return [];
    const now = getNow().getTime();
    return Object.values(db.routes)
      .filter((r) => r.driverId === session.profileId)
      .map((route) => {
        const bookings = Object.values(db.bookings).filter((b) => b.routeId === route.id);
        const ids = [route.originCityId, ...route.stops.map((s) => s.cityId), route.destinationCityId];
        return {
          route,
          vehicle: db.vehicles[route.vehicleId],
          pathLabel: ids.map(cityName).join(" → "),
          pendingRequests: bookings.filter((b) => b.status === "awaiting_driver").length,
          acceptedBookings: bookings.filter((b) => ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"].includes(b.status)).length,
          departed: Date.parse(`${route.travelDate}T${route.departureTime}:00+05:30`) <= now,
        };
      })
      .sort((a, b) => {
        // Active routes first (soonest departure first), then past routes (most recent first).
        const ra = a.route.status === "published" ? 0 : 1;
        const rb = b.route.status === "published" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        const ka = `${a.route.travelDate}${a.route.departureTime}`;
        const kb = `${b.route.travelDate}${b.route.departureTime}`;
        return ra === 0 ? ka.localeCompare(kb) : kb.localeCompare(ka);
      });
  }, [db, session]);
}

export function useDriverStats() {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => (session?.role === "driver" ? driverDashboardStats(db, session.profileId, getNow()) : null), [db, session]);
}

export function useEarnings() {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => {
    if (session?.role !== "driver") return null;
    return {
      summary: earningsSummary(db, session.profileId, getNow()),
      settlements: driverEarningEntries(db, session.profileId),
      payouts: driverPayouts(db, session.profileId),
    };
  }, [db, session]);
}

/** Options for the Add Route "Vehicle Type" select (existing vehicles + models). */
export function useVehicleOptions() {
  const db = useTakiStore((s) => s.db);
  const { session } = useSession();
  return useMemo(() => (session?.role === "driver" ? vehicleOptionsFor(db, session.profileId) : []), [db, session]);
}

// ───────────────────────────── Shared ─────────────────────────────

export function useNotifications(): { items: Notification[]; unreadCount: number; markAllRead(): void } {
  const notifications = useTakiStore((s) => s.db.notifications);
  const markRead = useTakiStore((s) => s.markNotificationsRead);
  const { session } = useSession();
  return useMemo(() => {
    if (!session) return { items: [], unreadCount: 0, markAllRead: () => {} };
    const items = Object.values(notifications)
      .filter((n) => n.recipientRole === session.role && n.recipientId === session.profileId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      items,
      unreadCount: items.filter((n) => !n.readAt).length,
      markAllRead: () => markRead(session.role, session.profileId),
    };
  }, [notifications, markRead, session]);
}
