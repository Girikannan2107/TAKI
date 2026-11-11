# Final Test Report — TAKI Travel web (2026-11-11)

**Owner:** T5 (Integration, Security & Performance).
- T5 did the static checks, the security review, wrote `tests/e2e/integration.spec.ts` and `tests/unit/integrity.test.ts`, and filed defects S-01 to S-04.
- T5 then hit the usage limit before running its browser suites and writing this report. The Lead ran those suites against the final build and wrote this report from the actual outputs.
- During that run the Lead fixed one spec bug: a case-sensitive `/^Log in/` locator; the button reads "Log In".

## 1. Environment

- Windows 11, Node 24.20.0, npm 11.19. Next.js 16.4.6 (Turbopack), React 19.3.0, TypeScript 5 (strict), Tailwind 4.3.3, zustand 5.1.0, zod 4.6.7, Vitest 5.1.0, Playwright 1.65.0 (Chromium), @axe-core/playwright 4.14.0.
- All e2e runs targeted the **production build** (`next build && next start -p 3100`), with `locale en-IN` and `timezone Asia/Kolkata`.

## 2. Commands and results (final build)

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **0 errors** |
| Lint | `npx eslint .` | **0 errors, 0 warnings** |
| Unit tests | `npx vitest run` | **83 / 83 passed** (6 files: pricing, booking machine, seed and search, commands, format and redirect, integrity) |
| Production build | `npx next build` | **Compiled; 31 / 31 routes generated** |
| E2E: developer specs + integration | `playwright test auth booking customer-search driver-requests driver-routes payment-tracking integration --project=desktop` | **55 / 55 passed** |
| E2E: customer + driver journeys (T2, T3) | `playwright test customer-journey driver-journey --project=desktop` | **47 / 47 passed** |
| E2E: visual capture (T1) | `playwright test visual --project=desktop --workers=1` | **31 / 31 passed** (screenshots in `test-results/visual/`) |
| E2E: responsive + a11y (T4) | `playwright test responsive-a11y --project=<all five>` | **35 passed, 20 skipped by design, 0 failed** (see `responsive-a11y.md`) |
| Mobile journeys | T2 / T3 happy paths, `--project=mobile` | Passed (T2 and T3 regression rounds) |
| Dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |

**Flakiness (honest note):**
- Three tests timed out once each while two testers shared the same server: a 30 s page load and a 30 s click under memory pressure.
- They passed 15/15 and 6/6 when run alone, and none recurred in the final runs.

## 3. Integration crawler and resilience (`integration.spec.ts`)

- **Crawler:** visited every route plus every same-origin `<a href>` found on them.
  - 9 public pages, 14 customer pages and 11 driver pages.
  - No 404 or 500 responses, no uncaught page errors, no console errors.
  - Every `<img>` loaded with `naturalWidth > 0`; `/_next/image` and `/assets/taki/**` requests returned 200.
  - Unknown paths render the branded 404 page with a home link.
- **Guards:**
  - Logged-out visits to protected pages redirect to `/auth/login?next=…`.
  - A wrong role is redirected to that role's own dashboard.
  - `next=//evil.example`, `https://evil.example`, `/\evil.example`, `javascript:alert(1)` and cross-role `/driver/earnings` are all ignored.
- **Resilience:**
  - With the hero image or logo asset blocked, the landing page still renders and works.
  - A failed JS chunk during client navigation doesn't white-screen the app.
  - Corrupt `localStorage` (unparseable JSON, wrong shape, old version) recovers without a crash.
- **Double submission:**
  - A double-click on Confirm withdrawal creates exactly one demo payout.
  - Pay, Accept and Publish are covered by the T2/T3 specs: triple-click Pay, double Enter, double Accept and double Publish each produce one record.

## 4. Security checklist

| Item | Result |
|---|---|
| Secrets in client bundle (`.next/static`, `src`) | Clean. The only env var in client chunks is `NEXT_PUBLIC_APP_MODE`. No Cashfree secret, `sk_` or PEM strings. `Taki@2025` appears only as documented demo credentials. |
| `.env*` ignored, `.env.example` names only | Yes (fixed in S-03: `.env*` plus `!.env.example`) |
| Fixed or bypass OTP | None. OTP comes from `crypto.getRandomValues`; resend invalidates the old code; max 5 attempts, 5 min expiry. |
| Live mode can't fake success | `authService` and `paymentService` fail closed in `NEXT_PUBLIC_APP_MODE=live` |
| Card, UPI or bank data collected | None. Method selection only. |
| Payment API stubs | `order`, `verify` and `webhook` return **501 `payments_not_configured`** (no-store). The client-sent `amount` is ignored. The webhook signature helper uses HMAC-SHA256 over timestamp + raw body with `timingSafeEqual` and rejects stale timestamps. `import "server-only"` (S-04). |
| Security headers | Present on HTML and API responses (S-01): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, `Permissions-Policy`. `X-Powered-By` removed. |
| XSS sinks | No `dangerouslySetInnerHTML` with user data |
| Passwords | Never stored in plaintext. Salted SHA-256 in localStorage, **demo only**; production must use Firebase Auth. |
| Authorization | Client guards are UX only. Real server-side authorization is documented as required (`docs/backend-integration.md`). |
| Demo honesty | No copy claims a real SMS, payment, payout or live GPS. Demo banners appear on OTP, payment, payout and maps. |

## 5. Performance (production build, localhost, desktop Chromium, 2 runs each)

| Page | TTFB | DCL | Load | LCP | Transfer | JS | Requests |
|---|---|---|---|---|---|---|---|
| `/` | 11 ms | 56–70 ms | 157–166 ms | 148–156 ms | 535 KB | 287 KB | 40 |
| `/customer/vehicles?…` | 7 ms | 58–82 ms | 151–193 ms | 248–328 ms | 534 KB | 320 KB | 46 |
| `/driver/dashboard` | 7–8 ms | 54–58 ms | 145–148 ms | 232–256 ms | 546 KB | 339 KB | 45 |

- No image over 300 KB and no unoptimised `<img>`. All rasters go through `next/image` (AVIF/WebP).
- These are localhost numbers, so they exclude network latency. Run Lighthouse on a deployed URL for field-like metrics.

## 6. Defect register (all phases)

| ID | Sev | Area | Summary | Owner | Status |
|---|---|---|---|---|---|
| R-01 | P2 | Driver requests | Pickup could be marked before the travel date | Lead + D8 | Fixed, verified (T3) |
| R-02 | P3 | Help | FAQ uses native `<details>` | D7 | Accepted deviation |
| C-01 | P3 | Booking details | Deep link with no search shows a notice, not an inline form | D5 | Accepted deviation |
| C-02 | P2 | Tracking | A paid booking couldn't be cancelled | D6 | Fixed, verified (T2) |
| V-01 | P2 | Vehicles | Truck photos on black studio backgrounds | Lead | Fixed, verified (T1) |
| V-02 | P2 | Landing | Hero photo upscaled at 768–1279 | D2 | Fixed, verified |
| V-03…V-11 | P3 | Various | Header inset, sparkline trend, card sizing, tabs overflow, text wraps, auth title and wave, map labels | D1/D2/D5/D6/D8/Lead | Fixed, verified (T1) |
| V-12 | P3 | Toast + modal | Clicking the toast × closed the modal | D1 | Fixed, verified (lead re-run) |
| S-01 | P1 | Config | No security headers | Lead | Fixed, verified |
| S-02 | P2 | Domain | Pending requests never expired after departure | Lead | Fixed: `expireDepartedRequests` plus unit tests |
| S-03 | P3 | Repo | `.env.production` not ignored | Lead | Fixed |
| S-04 | P3 | API | Missing `server-only` guard | D6 | Fixed |
| A-01…A-04 | P2/P3 | A11y | Logo and avatar label-in-name, `<dl>` structure, date-input focus ring | Lead (repair owner) | Fixed, verified (T4 spec) |

**Open defects: none.** All P0, P1 and P2 issues are fixed, or were accepted as deviations by the lead.

## 7. Release gates

| Gate | Status |
|---|---|
| Zero unresolved P0 | ✅ |
| Zero unresolved P1 | ✅ (S-01 fixed) |
| Main customer and driver flows working | ✅ (T2 32 tests, T3 15 tests, desktop + mobile) |
| Production build passing; no TS errors | ✅ |
| No unresolved critical console errors | ✅ (crawler and journey specs assert none) |
| Responsive design verified | ✅ (5 viewports, no overflow) |
| Key screenshot comparison completed | ✅ (`docs/qa/visual-audit.md`) |

## 8. Status of capabilities

- **Implemented and tested:**
  - All 23 pages plus the 404 page, navigation, validation, pricing, capacity and no overbooking, the booking state machine, request expiry, cancellation with demo refund, earnings and payouts.
  - Responsive layouts and accessibility (axe-clean).
- **Implemented with demo services:**
  - OTP (code shown on screen) and password login.
  - Payments, refunds and payouts (no money moves).
  - Tracking progression (driver actions plus a labelled demo simulation), and the illustrative route map.
  - localStorage persistence.
- **Prepared for integration:**
  - `AuthAdapter`, `PaymentAdapter`, the async marketplace service and the framework-free domain layer.
  - Cashfree route handlers (501 stubs plus a signature helper), env variables and security headers.
  - See `docs/backend-integration.md`.
- **Not implemented:**
  - Real SMS and Firebase Auth/Firestore, real payments, refunds and payouts, live GPS.
  - Server-side authorization, KYC, route cancellation with accepted bookings.
  - Testing with real screen readers; Lighthouse on a deployed URL.
