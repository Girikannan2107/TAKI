import { NextResponse, type NextRequest } from "next/server";
import { dashboardFor, loginFor, roleForPath, type AppRole } from "@/lib/config/routes";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { clearedSessionCookie, readCookie, verifySessionCookie } from "@/server/auth/session-cookie";

/**
 * Optimistic route gate (P2 §3.7). Verifies only the cookie's HMAC, role and expiry — no database.
 * Every API handler and server page re-authorises with requireSession(); this only saves a round trip.
 */
export const config = {
  matcher: ["/customer/:path*", "/agency/:path*", "/driver/:path*", "/admin/:path*", "/auth/login", "/signup/:path*"],
};

/**
 * Signed-out visitors may browse search → compare → vehicle details (confirmed with D3). `/customer` only
 * redirects to the dashboard. Everything else (incl. /customer/shipments/new and payment) needs a login.
 */
const CUSTOMER_GUEST_PATHS = ["/customer", "/customer/dashboard", "/customer/vehicles"];
const CUSTOMER_GUEST_PREFIXES = ["/customer/booking/"];

function isPublicInSection(pathname: string): boolean {
  if (pathname === "/admin/login") return true;
  if (CUSTOMER_GUEST_PATHS.includes(pathname)) return true;
  return CUSTOMER_GUEST_PREFIXES.some((p) => pathname.startsWith(p));
}

function redirect(req: NextRequest, to: string, clearCookie = false): NextResponse {
  const res = NextResponse.redirect(new URL(to, req.url));
  if (clearCookie) res.headers.append("set-cookie", clearedSessionCookie());
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const raw = readCookie(req.headers.get("cookie"));
  const session = await verifySessionCookie(raw);
  const signedInRole: AppRole | null = session?.r ?? null;
  const staleCookie = !!raw && !session;

  // Auth entry pages: a signed-in user goes home (unless switching accounts).
  if (pathname === "/auth/login" || pathname === "/signup" || pathname.startsWith("/signup/") || pathname === "/admin/login") {
    if (signedInRole && req.nextUrl.searchParams.get("switch") !== "1") {
      const next = safeRedirect(req.nextUrl.searchParams.get("next"), signedInRole);
      return redirect(req, next ?? dashboardFor(signedInRole));
    }
    return NextResponse.next();
  }

  const sectionRole = roleForPath(pathname);
  if (!sectionRole) return NextResponse.next();

  if (!signedInRole) {
    if (isPublicInSection(pathname)) return NextResponse.next();
    return redirect(req, loginFor(sectionRole, pathname + search), staleCookie);
  }

  if (signedInRole !== sectionRole) {
    // Guests' public customer pages stay open to everyone.
    if (sectionRole === "customer" && isPublicInSection(pathname)) return NextResponse.next();
    return redirect(req, dashboardFor(signedInRole));
  }

  return NextResponse.next();
}
