/**
 * Typed path builders for every v2 route (P3 §2) — never hard-code route strings in components.
 * Pages may 404 until their owner builds them; the paths are the contract.
 */

import type { PublicRole as DomainPublicRole, Role as DomainRole } from "@/lib/domain/model";

/** Every signed-in role (= domain `Role`). `admin` has no public signup (ops/seed only). */
export type AppRole = DomainRole;
/** Roles with a public signup / login tab. */
export type PublicRole = DomainPublicRole;
export type AuthFlowParam = "signup" | "login" | "reset";

export const APP_ROLES: readonly AppRole[] = ["customer", "agency", "driver", "admin"];
export const PUBLIC_ROLES: readonly PublicRole[] = ["customer", "agency", "driver"];

export function isAppRole(v: unknown): v is AppRole {
  return typeof v === "string" && (APP_ROLES as readonly string[]).includes(v);
}
export function isPublicRole(v: unknown): v is PublicRole {
  return typeof v === "string" && (PUBLIC_ROLES as readonly string[]).includes(v);
}

/** Route section (URL prefix) owned by each role. */
export const ROLE_SECTION: Record<AppRole, `/${string}`> = {
  customer: "/customer",
  agency: "/agency",
  driver: "/driver",
  admin: "/admin",
};

export type CustomerShipmentsTab = "pending" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "rejected" | "cancelled";
export type AgencyTripsTab = "upcoming" | "active" | "completed" | "cancelled" | "drafts";
export type AgencyBookingsTab = "pending" | "accepted" | "confirmed" | "rejected" | "cancelled";
export type AgencyDriversTab = "active" | "pending";
export type AgencyEarningsTab = "trips" | "bookings" | "payments" | "settlements";
export type DriverShipmentsTab = "pickup" | "transit" | "delivered";
export type AdminReviewStatus = "pending" | "verified" | "rejected";

type LoginOptions = { role?: PublicRole; next?: string; switch?: boolean };

export const paths = {
  home: "/",
  section: (id: "how-it-works" | "benefits" | "about" | "contact" | "goods") => `/#${id}`,

  // ── Auth (public) ──────────────────────────────────────────────
  /** No role → role selection (/signup). With a role → that role's details step (/signup/{role}). */
  signup: (role?: PublicRole, next?: string) => withQuery(role ? `/signup/${role}` : "/signup", { next }),
  /** `login(next)` (legacy) or `login({ role, next, switch })`. `switch=1` lets a signed-in user reach the form. */
  login: (opts?: string | LoginOptions) => {
    const o: LoginOptions = typeof opts === "string" ? { next: opts } : (opts ?? {});
    return withQuery("/auth/login", { role: o.role, next: o.next, switch: o.switch ? "1" : undefined });
  },
  phone: (q: { flow?: AuthFlowParam; role?: PublicRole; next?: string } = {}) => withQuery("/auth/phone", q),
  verifyOtp: (q: { flow?: AuthFlowParam; role?: PublicRole; next?: string } = {}) => withQuery("/auth/verify-otp", q),
  createPassword: (q: { flow?: "signup" | "reset"; role?: PublicRole; next?: string } = {}) => withQuery("/auth/create-password", q),
  /** Password recovery entry point (phone → OTP → new password). */
  resetPassword: (role?: PublicRole, next?: string) => withQuery("/auth/phone", { flow: "reset", role, next }),

  // ── Customer ───────────────────────────────────────────────────
  customer: {
    dashboard: "/customer/dashboard",
    /** New Shipment form; optional prefill from the dashboard quick-ship card. */
    newShipment: (q: { from?: string; to?: string; weight?: number | string; date?: string } = {}) => withQuery("/customer/shipments/new", q),
    vehicles: (
      q: {
        shipment?: string;
        from?: string;
        to?: string;
        weight?: number | string;
        unit?: "kg" | "t";
        date?: string;
        cargo?: string;
        sort?: string;
        types?: string;
        minPrice?: number | string;
        maxPrice?: number | string;
        minKg?: number | string;
      } = {},
    ) => withQuery("/customer/vehicles", q),
    /** Vehicle (trip) details. */
    booking: (tripId: string, shipmentId?: string) => withQuery(`/customer/booking/${encodeURIComponent(tripId)}`, { shipment: shipmentId }),
    payment: (bookingId: string) => withQuery("/customer/payment", { bookingId }),
    confirmation: (bookingId: string) => withQuery("/customer/booking-confirmation", { bookingId }),
    /** Canonical shipment details + tracking + feedback. */
    tracking: (bookingId: string) => `/customer/tracking/${encodeURIComponent(bookingId)}`,
    receipt: (bookingId: string) => `/customer/receipt/${encodeURIComponent(bookingId)}`,
    shipments: "/customer/shipments",
    shipmentsTab: (tab?: CustomerShipmentsTab) => withQuery("/customer/shipments", { tab }),
    payments: "/customer/payments",
    profile: "/customer/profile",
  },

  // ── Travel agency ──────────────────────────────────────────────
  agency: {
    dashboard: "/agency/dashboard",
    vehicles: "/agency/vehicles",
    newVehicle: "/agency/vehicles/new",
    vehicle: (vehicleId: string) => `/agency/vehicles/${encodeURIComponent(vehicleId)}`,
    drivers: (tab?: AgencyDriversTab) => withQuery("/agency/drivers", { tab }),
    newDriver: "/agency/drivers/new",
    driver: (driverId: string) => `/agency/drivers/${encodeURIComponent(driverId)}`,
    /** Add Trip step 1. */
    newTrip: (draft?: string) => withQuery("/agency/trips/new", { draft }),
    /** Add Trip step 2 (pricing). */
    tripPricing: (draft?: string) => withQuery("/agency/trips/new/pricing", { draft }),
    trips: (q: { tab?: AgencyTripsTab; published?: string } = {}) => withQuery("/agency/trips", q),
    trip: (tripId: string) => `/agency/trips/${encodeURIComponent(tripId)}`,
    bookings: (tab?: AgencyBookingsTab) => withQuery("/agency/bookings", { tab }),
    booking: (bookingId: string) => `/agency/bookings/${encodeURIComponent(bookingId)}`,
    history: (q: { q?: string; type?: string; from?: string; to?: string } = {}) => withQuery("/agency/history", q),
    earnings: (tab?: AgencyEarningsTab) => withQuery("/agency/earnings", { tab }),
    profile: "/agency/profile",
    verification: (onboarding?: boolean) => withQuery("/agency/profile/verification", { onboarding: onboarding ? "1" : undefined }),
    help: "/agency/help",
  },

  // ── Driver app (mobile-first) ──────────────────────────────────
  driver: {
    dashboard: "/driver/dashboard",
    shipments: (tab?: DriverShipmentsTab) => withQuery("/driver/shipments", { tab }),
    shipment: (bookingId: string) => `/driver/shipments/${encodeURIComponent(bookingId)}`,
    trip: (tripId: string) => `/driver/trips/${encodeURIComponent(tripId)}`,
    history: (q: { q?: string; month?: string } = {}) => withQuery("/driver/history", q),
    historyRecord: (bookingId: string) => `/driver/history/${encodeURIComponent(bookingId)}`,
    profile: "/driver/profile",
    documents: (onboarding?: boolean) => withQuery("/driver/profile/documents", { onboarding: onboarding ? "1" : undefined }),

    // Legacy owner-operator pages (moving to /agency/* — D2). Kept so current pages compile until removed.
    /** @deprecated use paths.agency.trips */
    routes: (q: { published?: string; status?: "active" | "completed" | "all" } = {}) => withQuery("/driver/routes", q),
    /** @deprecated use paths.agency.newTrip() */
    newRoute: "/driver/routes/new",
    /** @deprecated use paths.agency.tripPricing() */
    pricing: "/driver/routes/new/pricing",
    /** @deprecated use paths.agency.bookings() */
    bookings: (tab?: "pending" | "accepted" | "declined" | "withdrawn") => withQuery("/driver/bookings", { tab }),
    /** @deprecated use paths.agency.earnings() */
    earnings: "/driver/earnings",
    /** @deprecated use paths.agency.help */
    help: "/driver/help",
  },

  // ── Admin (hidden; no public links) ────────────────────────────
  admin: {
    dashboard: "/admin",
    login: (next?: string) => withQuery("/admin/login", { next }),
    agencies: (status?: AdminReviewStatus) => withQuery("/admin/agencies", { status }),
    agency: (agencyId: string) => `/admin/agencies/${encodeURIComponent(agencyId)}`,
    drivers: (status?: AdminReviewStatus) => withQuery("/admin/drivers", { status }),
    driver: (driverId: string) => `/admin/drivers/${encodeURIComponent(driverId)}`,
    settlements: "/admin/settlements",
  },
} as const;

/** Home (dashboard) for a signed-in role. */
export function dashboardFor(role: AppRole): string {
  switch (role) {
    case "customer":
      return paths.customer.dashboard;
    case "agency":
      return paths.agency.dashboard;
    case "driver":
      return paths.driver.dashboard;
    case "admin":
      return paths.admin.dashboard;
  }
}

/** Profile page for a role (TopBar avatar menu). */
export function profileFor(role: AppRole): string {
  switch (role) {
    case "customer":
      return paths.customer.profile;
    case "agency":
      return paths.agency.profile;
    case "driver":
      return paths.driver.profile;
    case "admin":
      return paths.admin.dashboard;
  }
}

/** Login page for a role (admin has its own hidden login). */
export function loginFor(role: AppRole, next?: string): string {
  return role === "admin" ? paths.admin.login(next) : paths.login({ role, next });
}

/** Which role's section a pathname belongs to (null for public pages). */
export function roleForPath(pathname: string): AppRole | null {
  for (const role of APP_ROLES) {
    const prefix = ROLE_SECTION[role];
    if (pathname === prefix || pathname.startsWith(prefix + "/") || pathname.startsWith(prefix + "?")) return role;
  }
  return null;
}

function withQuery(base: string, q: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
