# Implementation Plan — FROZEN CONTRACTS (Lead sync gate, 2026-11-10)

This document overrides any conflicting statement in the other planning docs. Read order for every Phase 2 agent:
1. this file → 2. `ui-design-spec.md` + `screen-inventory.md` (visuals, verbatim copy) → 3. `route-contract.md` + `component-contract.md` (routes, buttons, props) → 4. `data-contract.md` (types, pricing, seed) → 5. `acceptance-criteria.md` (what testers will check).

## 1. Resolved decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Cache Components | **OFF** (`next.config.ts`). The page pattern is still: `page.tsx` = server component exporting `metadata`, rendering a `"use client"` view. Views may use `useParams()` / `useSearchParams()` (wrap a view that uses `useSearchParams` in `<Suspense>` in the page). |
| 2 | Versions | Keep scaffold pins (next 16.4.6, react 19.3.0, tailwind 4.3.3 + `@tailwindcss/turbopack`). No new runtime deps without lead approval. **No jsdom / testing-library**: unit tests cover pure logic; components are verified by Playwright. |
| 3 | Domain types | `data-contract.md` §2 verbatim (P3 wins over P2 names). Money = integer rupees; rates = integer paise. |
| 4 | Booking lifecycle | Payment success → `awaiting_driver` (driver must accept) → `confirmed` → `picked_up` → `in_transit` → `out_for_delivery` → `delivered`. Confirmation page heading: **"Booking placed!"** with status badge "Awaiting driver confirmation" and "Demo payment — no money moves". Tracking timeline steps: Booking Confirmed, Picked Up, In Transit, Out for Delivery, Delivered (+ a leading "Payment received · awaiting driver" note while `awaiting_driver`). Tracking page has a clearly labelled **"Demo: simulate next update"** button that advances the booking through the same store actions (acceptance goes through the same capacity check as the driver's Accept). |
| 5 | Pricing | `data-contract.md` §5 exactly (per-line half-up rounding, fee slabs 350/500/750/1000). Board numbers changed per §5 table (Arjun ₹4,194, Meera ₹4,028, requests header "(5)", settlement TAKI874391, 498 km). Never hard-code board prices in UI — always read from store/`quote()`. |
| 6 | Offer URL | `/customer/booking/[vehicleId]` — the segment value is the **route id** of the offer (`VehicleOffer.routeId`, e.g. `rte_r1`). Keep the folder name `[vehicleId]` per the required route table. |
| 7 | Seed dates | Seed relative to "now" at seeding. Tracking booking TAKI874523 timestamps are offsets from now (confirmed −4h48m, picked up −2h30m, in transit −2h15m, expected out-for-delivery +5h) so they are never in the future. On load, if `demoMeta.seededOn ≠ today (IST)`, marketplace data is re-seeded (accounts + profiles kept) and a toast "Demo data refreshed for today" shows. Documented as a demo limitation. |
| 8 | Accounts | One account per mobile. Seeded logins (shown in the login page DemoBanner): customer **Arjun Kumar +91 98765 43210**, driver **Ravi Kumar (Raj Transport) +91 98765 43211**, password `Taki@2025`. Passwords stored as salted SHA-256 (WebCrypto) — demo only. New driver accounts get vehicles created on first route publish from the selected vehicle model. |
| 9 | Copy changes (demo honesty) | Phone: "We'll generate a one-time password (OTP) for verification." · OTP: "Enter the 6-digit code for +91 …" + DemoBanner showing the code · Track: "View Route" (not "View Live Route") · Landing step 3: "Pay online and track every step." · Withdraw opens a demo confirmation. Board typos fixed per P1. |
| 10 | Logo | Pin symbol `public/assets/taki/branding/taki_symbol_transparent.png` + "TAKI / TRAVEL" Montserrat wordmark (not the "Travel and Agriculture" full-logo PNG). |
| 11 | Auth layout | Centred card on warm background with green wave along the bottom (matches reference). No split layout. |
| 12 | Icons | Customer sidebar Profile uses `UserRound`. Lucide icons per `route-contract.md` §5. |
| 13 | "Stops" | `stopsCount = pathCityIds.length − 1` → Coimbatore → Salem → Vellore → Chennai = "3 Stops" (matches board). |
| 14 | Counts | All dashboard counts/headers derive from the store (Booking Requests 05 = 5 pending). |
| 15 | Out of scope | Driver cancelling a route with accepted bookings; real SMS/payment/GPS/payouts; server-side auth. |
| 16 | Hero pill | Badge "Smart Logistics Marketplace" uses darkened green `#2F7D43` for 4.5:1 contrast. |

## 2. Shared code that already exists (written by the Lead — import, do not modify)

All under `src/lib/`. Ask the lead (SendMessage to the team lead) for changes; do not edit these files.

| Path | Exports (key) |
|---|---|
| `domain/types.ts` | all P3 types |
| `domain/constants.ts` | `LIMITS`, `SERVICE_FEE_SLABS`, `OTP`, `DEMO_PASSWORD` |
| `domain/cities.ts` | `CITIES`, `getCity(id)`, `cityName(id)`, `legKm(a,b)`, `pathDistanceKm(ids)` |
| `domain/dates.ts` | `todayIst(now?)`, `addDaysIso`, `istInstant(date,time)`, `isoDateFromInstant`, `compareIso` |
| `domain/pricing.ts` | `roundHalfUp`, `quote({distanceKm,weightKg,ratePerKmPaise,ratePerKgPaise})`, `serviceFeeFor`, `estimateDurationMins`, `rupeesToPaise`, `paiseToRupeesString` |
| `domain/booking-machine.ts` | `transition(booking, event, ctx)`, `InvalidTransitionError`, `requestStatusOf(booking)` |
| `domain/search.ts` | `searchOffers(db, shipment, opts)` → `{ offers, excludedForCapacity }`, `offerFromRoute` |
| `domain/earnings.ts`, `domain/stats.ts` | `earningsSummary(db, driverId, now)`, `driverDashboardStats(db, driverId, now)` |
| `domain/labels.ts` | `customerStatusLabel`, `driverStatusLabel`, `badgeLabel`, `cargoLabel`, `paymentMethodLabel` |
| `data/seed.ts` | `buildSeed(now)` |
| `format/index.ts` | `formatINR`, `formatRate`, `formatKg`, `formatKm`, `formatDuration`, `formatDate`, `formatDateTime`, `formatTime`, `formatPhone`, `pad2`, `formatChangePct`, `shortName`, `routeLabel` |
| `store/index.ts` | `useTakiStore` (zustand, persisted `taki-demo-v1`), all business actions (see file header) |
| `store/selectors.ts` | hooks: `useSession`, `useCurrentCustomer`, `useCurrentDriver`, `useBooking(id)`, `useOffers(shipment)`, `useOffer(routeId, shipment)`, `useDriverStats`, `useEarnings`, `useDriverRequests`, `useDriverRoutes`, `useCustomerBookings`, `useCustomerPayments`, `useNotifications` |
| `store/StoreHydrator.tsx` | mounted once in `app/providers.tsx` |
| `hooks/useHydrated.ts` | `useHydrated(): boolean` |
| `services/auth` | `authService` (demo adapter): `sendOtp({mobile,flow,role,next})`, `resendOtp()`, `verifyOtp(code)`, `createAccount({fullName,password,businessName?})`, `resetPassword(pw)`, `login({mobile,password})`, `logout()`; demo code returned as `demoCode` and also in `useTakiStore(s=>s.otp)` |
| `services/payment` | `paymentService.pay({bookingId, method, idempotencyKey, simulateFailure?})` → `Payment`; `newIdempotencyKey(bookingId)`; `paymentService.mode` ("demo") |
| `services/marketplace.ts` | `marketplace.createBookingForPayment(routeId, shipment)`, `.cancelBooking(id)`, `.simulateNextUpdate(id)` (DEMO), `.acceptRequest(id)`, `.declineRequest(id)`, `.advanceShipment(id)`, `.publishRoute(draft)` (clears draft), `.requestPayout(amount, key)`, `.updateCustomerProfile`, `.updateDriverProfile`, `.updateVehicleRegistration`; `errorMessage(e)` for toasts |
| `domain/commands.ts`, `domain/vehicles.ts`, `domain/phone.ts` | `draftDistanceKm(draft)`, `previewQuote(...)`; `VEHICLE_MODELS`, `vehicleImageSrc(key)`, `vehicleModelLabel`, `maxPayloadForOption`; `normalizeIndianMobile`, `toE164`, `INDIAN_MOBILE_PATTERN` |
| `domain/search.ts` extras | `routePath`, `routeCityIds`, `routePathLabel`, `hasDeparted`, `OFFER_PROBLEM_MESSAGE`, `SortKey` |
| `domain/labels.ts` extras | `statusTone(status)`, `TIMELINE_STEPS`, `PAYMENT_STATUS_LABEL`, `PAYOUT_STATUS_LABEL`, `ROUTE_STATUS_LABEL` |
| `domain/cities.ts` extras | `cityLabel(id)` → "Coimbatore, Tamil Nadu" (form display as in the reference) |
| `store` extras | `useTakiStore(s => s.search / s.setSearch / s.routeDraft / s.updateRouteDraft / s.clearRouteDraft / s.pendingAuth / s.otp / s.resetDemo)`; selectors also export `useVehicleOptions()` |
| `data/seed.ts` | `DEMO_ACCOUNTS` (mobiles for the login DemoBanner) |
| `config/routes.ts` | `paths` builders (`paths.customer.booking(routeId)` …), `dashboardFor(role)` |
| `config/nav.ts` | `customerNav`, `driverNav` (label, href, icon, matchPrefixes) |
| `config/env.ts` | `appMode`, `isDemo` |
| `utils/cn.ts`, `utils/safe-redirect.ts` | `cn(...)`, `safeRedirect(next, role)` |

## 3. File ownership (exclusive write access)

| Agent | Owns (create/modify only these) |
|---|---|
| **Lead** | `src/lib/{domain,data,store,services,format,config,utils,hooks}/**`, `next.config.ts`, `package.json`, `vitest.config.ts`, `playwright.config.ts`, `tests/unit/{pricing,booking-machine,search,earnings,format,safe-redirect,store}.test.ts`, `docs/**`, `README.md`, `.env.example` |
| **D1** Design system & shell | `src/app/layout.tsx`, `src/app/globals.css`, `src/app/providers.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/loading.tsx`, `src/components/{ui,brand,layout}/**`, `src/app/customer/layout.tsx`, `src/app/driver/layout.tsx`, `src/app/customer/page.tsx`, `src/app/driver/page.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(public)/layout.tsx` |
| **D2** Landing | `src/app/(public)/page.tsx`, `src/features/landing/**` |
| **D3** Auth + profiles | `src/app/(auth)/{signup,auth}/**`, `src/features/auth/**`, `src/features/profile/**`, `src/app/customer/profile/**`, `src/app/driver/profile/**`, `src/lib/schemas/{phone,otp,password,login,profile}.schema.ts` |
| **D4** Customer dashboard, vehicles, shipments | `src/app/customer/{dashboard,vehicles,shipments}/**`, `src/features/{customer-search,shipments}/**`, `src/lib/schemas/shipment-search.schema.ts` |
| **D5** Booking details | `src/app/customer/booking/**`, `src/features/booking/**` (incl. `RouteMap`, `BookingSummary` — D6/D7 reuse) |
| **D6** Payment, confirmation, tracking, payments history | `src/app/customer/{payment,booking-confirmation,tracking,payments}/**`, `src/features/{payment,tracking,payments}/**`, `src/app/api/payments/**` |
| **D7** Driver dashboard, routes, route creation, help | `src/app/driver/{dashboard,help}/**`, `src/app/driver/routes/page.tsx`, `src/app/driver/routes/new/page.tsx`, `src/features/{driver-dashboard,driver-routes,help}/**` (not `driver-routes/pricing`), `src/lib/schemas/route-draft.schema.ts` |
| **D8** Pricing, requests, earnings | `src/app/driver/routes/new/pricing/**`, `src/app/driver/{bookings,earnings}/**`, `src/features/{pricing,driver-requests,earnings}/**`, `src/lib/schemas/route-pricing.schema.ts` |
| Phase 2 e2e specs | each D-agent may add `tests/e2e/<area>.spec.ts` for its own pages (optional; Phase 3 owns the full suite) |

Rules: never edit another agent's files — message the owner (or the lead) with the exact change. Reuse D1 primitives; do not create parallel Button/Input/Card components. No hex colours in components — use the `@theme` tokens D1 defines. Every page must work at 360 px wide with no horizontal scroll.

## 4. Sequencing

- **Stage A (parallel)**: D1 builds tokens/primitives/shells; Lead builds `src/lib/**` + unit tests. Gate: `npx tsc --noEmit` and `npm run build` pass; lead posts "Stage A done".
- **Stage B (parallel)**: D2–D8 build their pages against Stage A. Each agent must leave `npx tsc --noEmit` clean for its files and verify its pages render (`npm run build` is run by the lead at integration to avoid concurrent `.next` writes — agents use `npx tsc --noEmit` and `npx eslint <their paths>`; to view pages, use the shared dev server the lead runs on **http://localhost:3000** — do not start another `next dev`/`next build`).
- **Integration**: lead runs build/lint/typecheck/unit tests, fixes cross-cutting issues, commits.
- **Phase 3**: T1–T5 test; bugs routed to owners/repair owner; re-test until gates pass.

## 5. Answers to planner questions (record)
P1: Q1 tagline → "TAKI / TRAVEL"; Q4 stops → 3 incl. drop; Q5 copy → approved; Q7 auth → centred card. P3: Q1 `awaiting_driver` + "Booking placed!" → yes; Q2 settlement → TAKI874391; Q3 → offsets from now; Q4 → reseed marketplace only, keep accounts; Q5 → yes; Q6 → keep "(124 trips)"; Q7 → out of scope. P4: Q1 → compute from formulas (board numbers changed as listed); Q2/Q3 → demo wording approved; Q4 → derived; Q5 → layouts in A-17/C-23 accepted; Q6 → `UserRound`. P2: cacheComponents off; jsdom not approved.
