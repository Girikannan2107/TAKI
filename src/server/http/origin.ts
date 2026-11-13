import "server-only";
/**
 * CSRF defence for cookie-authenticated mutations (P2 §3.6): every non-GET request must
 * carry an Origin (or Referer) equal to APP_ORIGIN. In non-production, localhost/127.0.0.1
 * on any port is also accepted so `next dev -p 3100` and Playwright work.
 */
import { appOrigin, isProduction } from "../env";

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLocalhost(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = originOf(req.headers.get("origin")) ?? originOf(req.headers.get("referer"));
  if (!origin) return false;
  if (origin === appOrigin()) return true;
  if (!isProduction() && isLocalhost(origin)) return true;
  // Same-origin as the request URL (e.g. preview deployments).
  try {
    return origin === new URL(req.url).origin && !isProduction();
  } catch {
    return false;
  }
}

/** Client IP for rate limiting: first x-forwarded-for hop only when TRUST_PROXY_HEADERS=true. */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const xff = req.headers.get("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "local";
}
