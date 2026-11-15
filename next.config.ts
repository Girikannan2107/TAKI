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
