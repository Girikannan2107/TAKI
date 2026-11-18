import type { NextConfig } from "next";

/**
 * TAKI Travel — Next.js config (D5 owns the file; the redirects() block is D2's).
 * cacheComponents stays disabled for v2: every data screen is per-user and fetched from the
 * API at request time.
 *
 * Security headers:
 *  - Permissions-Policy allows geolocation (customer "current location") and camera (driver
 *    delivery proof) for this origin only (plan decision 16).
 *  - CSP keeps framing/base/object locked down; form-action also allows Cashfree's hosted
 *    checkout (sandbox + production), whose SDK loads from sdk.cashfree.com.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.cashfree.com; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(self)" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // ── D2 (agency) block ──────────────────────────────────────────────────────
  // Legacy owner-operator pages moved to the agency app. Only these six, temporary (307),
  // because /driver/* is now the new driver app. Query strings pass through.
  async redirects() {
    return [
      { source: "/driver/routes", destination: "/agency/trips", permanent: false },
      { source: "/driver/routes/new", destination: "/agency/trips/new", permanent: false },
      { source: "/driver/routes/new/pricing", destination: "/agency/trips/new/pricing", permanent: false },
      { source: "/driver/bookings", destination: "/agency/bookings", permanent: false },
      { source: "/driver/earnings", destination: "/agency/earnings", permanent: false },
      { source: "/driver/help", destination: "/agency/help", permanent: false },
    ];
  },
  // ── end D2 block ───────────────────────────────────────────────────────────
  // Dev / e2e: the browser calls same-origin /api/v1/* and Next proxies it to FastAPI, so local runs need no
  // CORS setup. In production NEXT_PUBLIC_API_BASE_URL points the browser at the API domain directly and this
  // rewrite is unused (it is only registered when a target is known).
  async rewrites() {
    const target = (process.env.API_PROXY_TARGET ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8000")).replace(/\/+$/, "");
    return target ? [{ source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` }] : [];
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
