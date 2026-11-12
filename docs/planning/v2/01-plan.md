# TAKI v2 — Consolidated Implementation Plan (orchestrator)

Inputs: `00-requirements.md` (brief + owner decisions), `p1-audit.md` (what exists), `p2-backend.md` (backend design — **authoritative for data model, API contracts, state machines, server layout**), `p3-ux.md` (UI design — **authoritative for tokens, sitemap, screens, components**). Where they disagree, this file decides.

## 1. Final decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Backend | Firestore via `firebase-admin`, server-only. Persistence behind P2's `DocStore` interface. Dev, E2E and seed use the **Firebase Emulator Suite** (project `demo-taki`, needs Java 21). Vitest runs on the in-memory DocStore in `tests/support/**`, which can only be injected when `VITEST` is set. The dev server refuses to start without the emulator; it never silently falls back to memory. |
| 2 | Auth | Server sessions (P2 §3), not Firebase Auth: scrypt passwords, hashed OTP labelled "Dev OTP" in dev, an HMAC-signed httpOnly cookie, a revocable sessions collection, optimistic `src/proxy.ts` plus `requireSession` in every handler. |
| 3 | Roles | `customer`, `agency`, `driver`, **`admin` (new, owner decision)**. Admin users are created only through the ops script or seed; no public signup. One phone number = one account = one role (simplest; P3 Q7). |
| 4 | Agency verification | **Minimal hidden `/admin` page** (owner): list pending agencies and drivers, view masked documents through the access-checked file route, verify or reject with a reason. Unverified agencies can sign in and set up vehicles and drivers but **cannot publish trips**. The ops script mirrors the same actions. |
| 5 | Driver onboarding | Both paths (P3 Q2): the agency adds a driver by phone (invite), or the driver self-registers and picks an agency. Either way, the driver is active for trips only after the agency approves. |
| 6 | Booking statuses | P2 §5.1: `awaiting_agency → pending_payment ⇄ payment_failed → confirmed → picked_up → in_transit → out_for_delivery → delivered`; plus `rejected` and `cancelled`. The customer-tab mapping and tracking stages are in P2 §5.1. Cancellation is allowed only before pickup. |
| 7 | Capacity | Whole-trip capacity (a booked kg is held for the whole trip, as Phase 1 does). Holds live on the trip document (P2 §6.1); an unpaid hold stops counting once it expires. Transactions plus idempotency keys. Per-segment capacity is a documented later enhancement. |
| 8 | Places | A district dataset for the 5 states (TN, KL, KA, TS, AP), with approximate road distance = haversine × road factor, labelled "approx." in the UI. Shared by trip checkpoints and shipment addresses. Pincode is validated as 6 digits plus state prefix only. The "current location" option uses browser geolocation → nearest district; there is no paid reverse geocoding. |
| 9 | Pricing | Per-km × segment km + per-kg × weight + handling fee (if special handling) + TAKI service fee; GST is not itemised (P3 Q5). All amounts are computed server-side. |
| 10 | Payments | Gateway interface: Cashfree sandbox plus a dev gateway that needs an explicit server **Approve** step. Nothing auto-succeeds. Refunds go through an outbox. |
| 11 | Earnings | **Read-only settlements** (owner): built from real payment and booking records. Ops/admin marks settlements as settled. No withdraw button. The Phase 1 seeded `archivedMonths` and payouts are removed. |
| 12 | Tracking | Only real events: driver pickup (OTP), checkpoint arrive/depart, out for delivery, delivery (OTP + proof photo + remarks), each server-timestamped. **The customer "simulate next update" control is removed.** No live GPS; the map is labelled illustrative. |
| 13 | Routes | Today's `/driver/*` operator UI moves to **`/agency/*`** (with redirects for one release). `/driver/*` becomes the new mobile-first driver app. `/admin/*` is new. |
| 14 | Tokens | P3 §1.4 exactly: canvas `#E7EDE3`, brand/sidebar `#244F3F`, coral `#F08065` only as an accent with dark text, `ink-subtle` → `#606762`. |
| 15 | Contact form | `POST /api/public/contact` stores to a `contactMessages` collection (rate-limited). |
| 16 | Permissions-Policy | Allow `geolocation=(self)` and `camera=(self)` (needed for current location and delivery proof). |

## 2. Agents and ownership (one owner per file; merge of P2 §12 and P3 §7)

| Agent | Owns |
|---|---|
| **D5 Backend core & integration** | `package.json`/lockfile, `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `next.config.ts` (except the redirects block), `.env.example`, `.gitignore`, `vitest*.config.mts`, `playwright.config.ts`; `scripts/**` (seed, ops incl. verify-agency/settle, sweep); `src/lib/domain/{types,booking-machine,capacity,pricing,constants,ids,places/*,deciders/*}`; `src/lib/api/{http.ts,contracts/common.ts,contracts/errors.ts,contracts/payments.ts,contracts/notifications.ts,client/payments.ts,client/notifications.ts}`; `src/server/{env,clock,firebase,db,repos,files,http,core,payments,seed}/**`, `src/server/views/common.ts`; `src/app/api/{payments,notifications,reviews,internal,health,public}/**`; `tests/support/**`; `tests/unit/server/core/**`, `tests/unit/server/payments/**`; the legacy demo store/services removal (`src/lib/store/**`, `src/lib/services/**`, `src/lib/data/seed.ts`) **after** D1–D4 have migrated off them. |
| **D1 Auth, accounts, admin & shared UI foundation** | `src/proxy.ts`; `src/server/auth/**`, `src/server/modules/{auth,profile,admin}/**`; `src/lib/api/contracts/{auth,admin}.ts`, `src/lib/api/client/{auth,admin}.ts`; `src/app/api/{auth,me,files,geo,admin}/**`; `src/app/(auth)/**`, `src/app/admin/**`; `src/features/{auth,account,admin}/**`; **Wave 0 UI foundation:** `src/app/globals.css`, `src/components/ui/**`, `src/components/layout/**` except SiteHeader*/SiteFooter, `src/lib/config/{nav,routes}.ts`; `tests/e2e/auth.spec.ts`, `tests/e2e/admin.spec.ts`, `tests/unit/server/auth/**`. |
| **D2 Agency** | `src/server/modules/agency/**`, `src/server/views/agency.ts`, `src/lib/domain/trip-rules.ts`, `src/lib/api/{contracts,client}/agency.ts`, `src/app/api/agency/**`, `src/app/agency/**`, `src/features/agency/**` plus inherited `src/features/{driver-dashboard,driver-routes,driver-requests,pricing,earnings,help}/**`, `src/features/profile/VehicleList.tsx`; the `redirects()` block in `next.config.ts` (send the exact snippet to D5); `tests/e2e/{driver-journey,driver-routes,driver-requests}.spec.ts` → repoint to agency (rename allowed), `tests/unit/server/agency/**`. |
| **D3 Customer** | `src/server/modules/customer/**`, `src/server/views/customer.ts`, `src/lib/domain/matching.ts`, `src/lib/api/{contracts,client}/customer.ts`, `src/app/api/customer/**`, `src/app/customer/**`, `src/features/{customer-search,customer-shipment,booking,payment,payments,shipments,tracking}/**`, `src/features/profile/ProfileView.tsx`, `src/lib/schemas/shipment-search.schema.ts`; `tests/e2e/{customer-journey,customer-search,booking,payment-tracking}.spec.ts`, `tests/e2e/booking-flow.ts`, `tests/unit/server/customer/**`. |
| **D4 Driver app & landing** | `src/server/modules/driver/**`, `src/server/views/driver.ts`, `src/lib/api/{contracts,client}/driver.ts`, `src/app/api/driver/**`, `src/app/driver/**` (rewrite; delete the old operator pages only after D2 confirms `/agency` and the redirects work), `src/features/driver-app/**`, `src/features/landing/**`, `src/components/layout/SiteHeader*.tsx`, `SiteFooter.tsx`; `tests/e2e/driver-app.spec.ts`, `tests/unit/server/driver/**`. |
| **Orchestrator** | `docs/**`, `README.md`, `tests/e2e/{responsive-a11y,visual,integration}.spec.ts`, `test-results/**`, git commits, integration fixes. |

**Rules for all dev agents**
- Read `AGENTS.md`: Next.js 16.4.6 has breaking changes, so check `node_modules/next/dist/docs/` before writing route handlers, proxy, cookies or server code.
- Edit only files you own. Changes to someone else's file go by **SendMessage to the owner** with the exact change. Never edit `package.json`: ask D5.
- Cross-role state transitions are called **only through D5 `src/server/core/*`**.
- **Do not `git commit`** and do not run `next build`, `next dev` or Playwright (they collide in the shared tree). Run `npx tsc --noEmit`, `npx eslint <your paths>` and `npx vitest run <your tests>`. The orchestrator builds and runs E2E at wave boundaries.
- Preserve existing components and branding; reuse before creating. Follow P3 for screens and P2 for contracts.
- No static mock data in UI. Data comes from API endpoints; dev data comes from the seed through repositories.
- Every new screen has loading, empty, error and success states and works at 360px.

## 3. Waves

- **Wave 0 (foundations, parallel, disjoint files):** D5 runs P2 §12 "day-0": deps, Firebase config, DocStore + memory store, schema, handler/errors/http, `contracts/common.ts`, `core/*` signatures, the places dataset, pricing v2, booking machine v2. D1 does the UI foundation (tokens, primitives, shell incl. bottom nav and admin/agency roles, nav.ts/routes.ts with every route) and `requireSession`/session types. Both report when done; the orchestrator then runs typecheck and commits.
- **Wave 1 (modules, parallel):** D1 auth flows (3 signups, login, recovery, profile, admin page); D2 agency module; D3 customer module; D4 driver app + landing; D5 implements `core/*` (bookings, trips lifecycle, capacity, tracking, notify, earnings, reviews, sweep), payments, files, seed and ops.
- **Wave 2 (integration):** emulator up, seed, `next build`, E2E. D5 removes the legacy demo store once nothing imports it. The orchestrator fixes cross-module seams and commits.
- **Wave 3 (testing):** T1 UI/UX, T2 workflow, T3 integration/security. Bugs carry severity and repro steps, go to the owning dev agent, are fixed, and are retested.

## 4. Preconditions

- **Java 21** must be installed for emulator-backed runs (Wave 2+). Waves 0–1 proceed on vitest + the memory DocStore.
