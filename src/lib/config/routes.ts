import type { Role } from "@/lib/domain/types";

/** Typed path builders — never hard-code route strings in components. */
export const paths = {
  home: "/",
  section: (id: "how-it-works" | "benefits" | "about" | "contact") => `/#${id}`,
  signup: (role?: Role, next?: string) => withQuery("/signup", { role, next }),
  login: (next?: string) => withQuery("/auth/login", { next }),
  phone: (q: { flow?: "signup" | "login" | "reset"; role?: Role; next?: string } = {}) => withQuery("/auth/phone", q),
  verifyOtp: (q: { flow?: "signup" | "login" | "reset"; role?: Role; next?: string } = {}) => withQuery("/auth/verify-otp", q),
  createPassword: (q: { flow?: "signup" | "reset"; role?: Role; next?: string } = {}) => withQuery("/auth/create-password", q),
  customer: {
    dashboard: "/customer/dashboard",
    vehicles: (q: { from?: string; to?: string; weight?: number | string; unit?: "kg" | "t"; date?: string; sort?: string } = {}) =>
      withQuery("/customer/vehicles", q),
    booking: (routeId: string) => `/customer/booking/${encodeURIComponent(routeId)}`,
    payment: (bookingId: string) => withQuery("/customer/payment", { bookingId }),
    confirmation: (bookingId: string) => withQuery("/customer/booking-confirmation", { bookingId }),
    tracking: (bookingId: string) => `/customer/tracking/${encodeURIComponent(bookingId)}`,
    shipments: "/customer/shipments",
    payments: "/customer/payments",
    profile: "/customer/profile",
  },
  driver: {
    dashboard: "/driver/dashboard",
    routes: (q: { published?: string; status?: "active" | "completed" | "all" } = {}) => withQuery("/driver/routes", q),
    newRoute: "/driver/routes/new",
    pricing: "/driver/routes/new/pricing",
    bookings: (tab?: "pending" | "accepted" | "declined") => withQuery("/driver/bookings", { tab }),
    earnings: "/driver/earnings",
    profile: "/driver/profile",
    help: "/driver/help",
  },
} as const;

export function dashboardFor(role: Role): string {
  return role === "customer" ? paths.customer.dashboard : paths.driver.dashboard;
}

function withQuery(base: string, q: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
