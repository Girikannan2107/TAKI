# P1 — Codebase Audit (TAKI v2)

Auditor: P1. Date: 2026-11-13. Branch `feat/marketplace` @ `cc0d69e`. Read-only audit; no app code changed.
Inputs: `docs/planning/v2/00-requirements.md`, `AGENTS.md`, `docs/backend-integration.md`, source under `src/`, `tests/`.

---

## 1. Architecture map

```
Browser only (no server data layer today)
┌──────────────────────────────────────────────────────────────────────────┐
│ app/ (App Router)                                                         │
│   (public)/page.tsx  landing (server comp + client islands)               │
│   (auth)/signup, auth/{phone,verify-otp,create-password,login}            │
│   customer/*  (layout → RequireRole role=customer, guestPaths)            │
│   driver/*    (layout → RequireRole role=driver)                          │
│   api/payments/cashfree/{order,verify,webhook}  ← ONLY server code; 501   │
├──────────────────────────────────────────────────────────────────────────┤
│ features/* (views)  ──read──▶ lib/store/selectors.ts (hooks over Db)      │
│                     ──write─▶ lib/services/marketplace.ts (async facade)  │
│                               lib/services/auth/demo-auth.ts              │
│                               lib/services/payment/{demo-payment,cashfree}│
├──────────────────────────────────────────────────────────────────────────┤
│ lib/store/index.ts  zustand + persist(localStorage "taki-demo-v1")        │
│   mutate(fn): structuredClone(db) → run command → commit (atomic per tab) │
│   sweepExpired() runs expireDepartedRequests on hydrate/interval          │
├──────────────────────────────────────────────────────────────────────────┤
│ lib/domain/* — framework-free pure rules (portable to server)             │
│   types.ts, db.ts (Db shape + DomainError + CommandContext{now,rand})     │
│   commands.ts (requestBooking/accept/decline/recordPayment/cancel/        │
│     advanceShipment/expireDepartedRequests/publishRoute/requestPayout)    │
│   booking-machine.ts (transition table), search.ts, pricing.ts,           │
│   cities.ts (14 cities + km table), dates.ts (IST), ids.ts, earnings.ts   │
│ lib/data/seed.ts — deterministic demo seed (drivers, routes, bookings,    │
│   archived earnings) rebuilt daily                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Data flow (customer booking, Phase 1): `ShipmentForm` → `/customer/vehicles?from&to&weight&date` → `useOffers` → `searchOffers(db)` → `RouteBookingView` → `marketplace.requestBooking` → `commands.requestBooking` (status `awaiting_driver`, pricing snapshot, notification to driver) → driver `BookingRequestsView` → `acceptBooking` (capacity decremented, `paymentDueAt` = min(now+120 min, departure)) → `PaymentView` → `demoPaymentAdapter.pay` → `recordPayment` (→ `confirmed`, pickup/delivery OTPs generated) → driver `advanceShipment` (OTP at pickup and delivery) → `delivered` → `EarningEntry` credited.

Key seams already designed for swap (`docs/backend-integration.md` §1): `AuthAdapter` (`src/lib/services/auth/types.ts`), `PaymentAdapter` (`src/lib/services/payment/types.ts`), `marketplace` facade (async, throws `DomainError`), selector hooks. Mode switch `NEXT_PUBLIC_APP_MODE` (`src/lib/config/env.ts`).

Authorization today: `marketplace.requireRole()` reads `session` from the zustand store; `RequireRole` (`src/components/layout/RequireRole.tsx`) is a client redirect. There is no `src/proxy.ts` (Next 16's renamed middleware) and no server session.

---

## 2. Feature inventory vs v2 brief

Legend: **done** = meets v2 as written; **partial** = exists but v2 adds scope; **missing**; **conflicts** = current behaviour contradicts a v2 rule.

### A. Landing
| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Navbar (logo, How It Works, Benefits, About, Contact, Login) | done | `src/components/layout/SiteHeader*.tsx`, `paths.section()` in `src/lib/config/routes.ts` | Verify mobile drawer. |
| Hero + headline "Your goods. Their route. One smart connection." | done | `src/features/landing/HeroSection.tsx`, `content.ts:21` | |
| CTAs Ship Goods / List a Route | done | `HeroSection.tsx:81,84` | "List a Route" must target agency signup in v2. |
| How TAKI Works (Find a Route / Choose a Vehicle / Ship with Ease) | done | `HowItWorksCard.tsx`, `content.ts:31-35` | Copy says "Pay online" — still valid. |
| Benefits for customers and agencies | partial | `BenefitsSection.tsx`, `content.ts:45-80` | Copy targets "drivers"; reword for agencies. |
| Supported goods categories with images | partial | `CARGO_TILES` in `content.ts:90`, rendered inside `BenefitsSection.tsx:42` | 4 tiles nested in Benefits, not its own section. |
| Two-sided marketplace section | partial | `AudienceSplit.tsx` ("One marketplace, two ways") | Customer vs driver; becomes customer vs agency (+driver). |
| Contact form | conflicts | `ContactForm.tsx:16,30` | zod-validated but only toasts "nothing was sent"; rule 5 requires it to work → needs a server endpoint/collection. |
| About, Footer | done | `AboutSection.tsx`, `SiteFooter.tsx` | |

### B. Authentication
| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Separate signup/login for 3 roles | partial | `RoleSelectView.tsx`, `Role = 'customer' \| 'driver'` (`types.ts`) | Only 2 roles; one shared login by mobile+password. |
| Customer: name, DOB 18+, phone OTP, password, confirm | partial | `CreatePasswordView.tsx`, `password.schema.ts` | No DOB / age check. |
| Agency: owner, agency name, district, vehicle range, states, OTP, Aadhaar/PAN/license doc, photo, password | missing | — | Closest: driver `businessName` (optional). No uploads anywhere. |
| Driver: name, OTP, DL, Aadhaar, associated agency, photo, password | missing | — | Today's "driver" = owner-operator. |
| Phone OTP | conflicts | `demo-auth.ts` (client-generated code, persisted in localStorage via `partialize.otp`, store `index.ts:162`) | v2 needs server-generated, hashed, expiring, rate-limited OTP; UI label must become "Dev OTP" (today "Demo OTP", testid `demo-otp-code`). Rate limits exist client-side only (`OTP` in `constants.ts`). |
| Password storage / login lockout | conflicts | `demo-auth.ts:31` salted SHA-256 in localStorage; `LOGIN_LOCK` | Needs server-side scrypt/argon2 or Firebase Auth; lockout server-side. |
| Role-based access | conflicts | `RequireRole.tsx` (UX only), `marketplace.ts:15` | Forgeable: any user can edit localStorage `session`. Needs server session + `proxy.ts` optimistic check + per-handler authZ. |
| Password recovery | partial | `LoginView.tsx:109` → `flow=reset`, `demoAuth.resetPassword` | Flow exists; must move server-side. |

### C. Customer
| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Nav: Dashboard, New Shipment, My Shipments, Profile | partial | `customerNav` in `src/lib/config/nav.ts` = Home, My Shipments, Payments, Profile | No separate New Shipment page (form lives on dashboard); extra Payments page (`/customer/payments`). |
| Dashboard: welcome, active/completed/pending counts, recent activity, quick Ship Goods | partial | `DashboardView.tsx` (greeting + `ShipmentForm` + `RecentShipments`) | No stat cards; `StatCard` component exists (`ui/StatCard.tsx`). |
| New Shipment: source (current location or manual), full address, district, pincode, state; same for destination; receiver name/phone; weight, package type, description, shipping date, special handling | partial | `ShipmentForm.tsx`, `shipment-search.schema.ts`, `Shipment` type | Only city (14 fixed cities), weight, date, optional `cargoType` (5 values). No address/pincode/district/state, receiver, package type, description, handling, geolocation (note `Permissions-Policy geolocation=()` in `next.config.ts` blocks it). |
| Find Vehicles cards (image/type, agency+driver, route+checkpoints, dep/arr, capacity, price, rating) | partial | `VehicleCard.tsx`, `VehicleOffer` in `types.ts` | No arrival time, no agency/driver split, checkpoints are city names only. Rating is seeded static (`driver.ratingAvg`). |
| Filters: vehicle type, price, date, capacity | missing | `VehiclesView.tsx:23` | Date is a search input, not a filter. No filters. |
| Sort: lowest/highest price, earliest departure/arrival | partial | `SORT_OPTIONS` `VehiclesView.tsx:23-28`; `SortKey` in `search.ts` | Has best/price/rating/capacity; `departure` sorter exists but not exposed; no highest-price, no arrival. |
| Matching: route order, date, capacity, goods restrictions | partial | `searchOffers`/`offerFromRoute`/`offerProblem` in `search.ts` | Order, exact date, capacity, published, not departed: done. Goods restrictions: missing (no route restriction field; `cargoType` unused in matching). |
| Vehicle Details (overview, driver, reviews, agency, route, restrictions, capacity, cost breakdown) | partial | `RouteBookingView.tsx`, `BookingSummary.tsx`, `RouteMap.tsx` | Has route, capacity, price breakdown (per-km + per-kg + service fee). No reviews, agency info, restrictions. `RouteMap` is illustrative. |
| Booking request → agency approval → pay | done (as owner-operator) | `commands.ts` `requestBooking`/`acceptBooking`/`recordPayment` | Approver must become agency. |
| Payment: provider-configurable, sandbox in dev, never mark paid without real confirmation | conflicts | `demo-payment.ts` (auto-succeeds after 1.2 s client-side), `payment/index.ts` | v2 binding: success only after server-side confirmation step. Cashfree handlers are stubs (501). Stale comments in `verify/route.ts` and `webhook/route.ts` say `pending_payment → awaiting_driver` (pre-Phase-1 order); correct target is `pending_payment → confirmed`. |
| My Shipments tabs: Pending, Confirmed, Picked Up, In Transit, Delivered, Rejected, Cancelled | partial | `ShipmentsView.tsx:16` (Active / Completed / Cancelled), `shipmentGroup()` | Needs 7 status tabs. |
| Shipment details (driver, vehicle, receiver, route, timeline, booking) | partial | `TrackingView.tsx`, `StatusTimeline.tsx`, `ReceiptView.tsx` | No receiver; driver ≠ agency. |
| Tracking: Booking → Confirmation → Pickup → In Transit → Checkpoints → Out for Delivery → Delivered | partial | `statusHistory` + `StatusTimeline.tsx` | No checkpoint events. |
| Never fabricate tracking | conflicts | `simulateNextUpdate` (`commands.ts:433`, `TrackingView.tsx:109-243`), seed history (`seed.ts:315`) | "Demo: simulate next update" must be removed. |
| Cancel only before pickup | done | `TRANSITIONS.cancel` (`booking-machine.ts`), `CancelPaidBooking.tsx` | Refund is an instant status flip (`refundPayments`) — needs real refund via provider. |
| Feedback / rating after delivery | missing | — | No Review model or UI (`Rating.tsx` display component only). |
| Profile: edit details, photo, password, phone change via OTP | partial | `ProfileView.tsx` | Name only; mobile explicitly locked; no photo/password change. |

### D. Agency module (today's `/driver/*` is the closest analogue)
| Nav item | Status | Evidence | Notes |
|---|---|---|---|
| Dashboard (totals, active/upcoming trips, pending bookings, completed, revenue, activity) | partial | `DriverDashboardView.tsx`, `driverDashboardStats` (`earnings.ts:52`), `EarningsHeroCard.tsx`, `MiniAreaChart.tsx` | No vehicle/driver totals. |
| Vehicles (type, reg, photo, capacity, restrictions, specs; edit/remove) | partial | `profile/VehicleList.tsx` (edit registration only); vehicles auto-created on first publish (`publishRoute`, `"new:"` ids, reg "Not added yet") | No CRUD page, photo, restrictions. `Vehicle.driverId` must become `agencyId`. |
| Drivers (add/edit/remove, docs, assign, no overlap) | missing | — | No agency↔driver relation. |
| Add Trip (vehicle, driver, capacities, goods, route, checkpoints w/ timings, dep/arr, per-kg/per-km, publish or draft) | partial | `AddRouteView.tsx`, `SetPricingView.tsx`, `publishRoute` (`commands.ts:450`), `route-draft.schema.ts`, `route-pricing.schema.ts` | Has stops (≤5, km only), total/offered capacity, rates, vehicle-per-date clash check. Missing: driver, goods, checkpoint timings, arrival, save-draft (`RouteStatus 'draft'` reserved, unused). Draft persisted only in localStorage. |
| Trips (upcoming/active/completed/cancelled, booked vs remaining) | partial | `MyRoutesView.tsx`, `RouteCard.tsx`, `useDriverRoutes` | Tabs active/completed/all; no cancel-trip command. |
| Bookings (accept/reject, notify, share details both ways, atomic reservation) | partial | `BookingRequestsView.tsx`, `BookingRequestCard.tsx`, `acceptBooking`/`declineBooking` | Accept/decline + notifications done; atomicity is per-browser only. |
| History (searchable) | missing | — | |
| Earnings (total, trip/booking-wise, payment history, settlement, transactions; no fabricated records) | conflicts | `EarningsView.tsx`, `WithdrawModal.tsx`, `requestPayout` (simulated), `archivedMonths` seeded (`seed.ts:340`) | Seeded history and simulated payouts violate "no fabricated records". |
| Profile (agency details, verification, phone OTP update) | partial | `ProfileView.tsx` (name, businessName, vehicles) | `Driver.isVerified` seeded flag only. |
| Help | done | `HelpView.tsx` | Content references driver/pricing. |

### E. Driver app (new role)
| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Nav: Dashboard, Assigned Shipments, History, Profile (mobile-first) | missing | — | Reuse `DashboardShell` + `MobileNavDrawer`. |
| Confirm pickup / delivery | partial | `advanceShipment` with OTP (`commands.ts:370`) from `BookingRequestsView` | Logic reusable; must be driver-scoped. |
| Checkpoint arrival/departure | missing | — | `in_transit` / `out_for_delivery` are single steps. |
| Delivery proof upload, remarks | missing | — | No storage layer; `note` field exists on `BookingStatusEvent`. |
| History, profile w/ agency + reviews | missing | — | |

### Backend models / cross-cutting
| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Persistent models: users+role profiles, agencies, vehicles, drivers, trips, checkpoints, shipments, bookings, payments, tracking events, reviews, notifications | partial | `Db` (`src/lib/domain/db.ts`) | Present (in localStorage): accounts, customers, drivers(=operators), vehicles, routes, bookings (shipment embedded), payments, earnings, payouts, notifications. Missing: agencies, driver profiles, checkpoints, shipments as own entity, tracking events collection, reviews. |
| Atomic capacity reservation | partial | `acceptBooking`, `releaseCapacity`, `capacityInvariantHolds` (`earnings.ts:74`) | Correct logic; needs Firestore transaction. |
| Notifications | partial | `notify()` (`commands.ts:44`), `useNotifications` → `TopBar.tsx` | Role union is 2 roles; in-app only. |
| Reviews | missing | `Driver.ratingAvg/ratingCount` seeded | |

---

## 3. Reusable assets

**UI (keep, extend):** `src/components/ui/*` — Avatar, Badge, Button, Card, Chip, ConfirmDialog, Drawer, EmptyState, FormField, IconButton, Input, MiniAreaChart, Modal, OtpInput, PasswordInput, PhoneInput, RadioCard, Rating, Select, Skeleton, Spinner, StatCard, Tabs, Toast (+ `useToast`, `useDialog`). Layout: `DashboardShell`, `DashboardSidebar`, `MobileNavDrawer`, `TopBar` (notifications bell), `PageHeader`, `AuthLayout`, `AuthCardHeader`, `SiteHeader*`, `SiteFooter`, `SkipLink`, `DashboardSkeleton`, `RequireRole` (keep as UX guard). Brand: `Logo`, `WaveDecoration`. Nav config pattern `src/lib/config/nav.ts` (+ `isNavItemActive`) and typed `paths` (`routes.ts`) — add `agency`/`driver` trees. Design tokens in `src/app/globals.css`. A11y/visual polish has been QA'd (commits `c3ab0c9`, `4a2345f`).

**Feature views worth adapting:** `ShipmentForm`, `VehicleCard`, `VehiclesView`, `RouteBookingView`, `BookingSummary`, `RouteMap` (illustrative only — label it), `PaymentView`/`PaymentMethodSelector`, `TrackingView`/`StatusTimeline`/`CancelPaidBooking`/`BookingIdCopy`, `ReceiptView`, `ShipmentsView`, `BookingRequestsView`/`BookingRequestCard`, `AddRouteView`/`SetPricingView`/`PricePreview`, `MyRoutesView`/`RouteCard`, `DriverDashboardView`/`EarningsHeroCard`, `EarningsView`, auth views (`PhoneView`, `VerifyOtpView`, `CreatePasswordView`, `LoginView`, `RoleSelectView`).

**Domain logic to port server-side (framework-free already; takes `CommandContext{now,rand}`):**
- `pricing.ts` — integer paise, `roundHalfUp`, `quote()`, `serviceFeeFor` slabs, `rupeesToPaise`. Keep verbatim; add "transparent extra charges" lines.
- `search.ts` — `routePath`, `offerFromRoute` (pickup-before-drop on ordered path, segment km), `offerProblem` + messages, `searchOffers`, sorters, badges. Extend with goods restrictions, filters, arrival sort; Firestore query should pre-filter by `travelDate` + `status`, then apply this in memory.
- `booking-machine.ts` — transition table, idempotent `transition()`, `requestStatusOf`, `CAPACITY_HOLDING`, `shipmentGroup`, `reachedAt`. Add checkpoint events, `rejected` naming, agency actor.
- `commands.ts` — `requestBooking` (dedupe of open requests), `acceptBooking` (capacity reserve + price relock + payment window), `declineBooking`, `recordPayment` (idempotency key, single success, window), `cancelBooking` (release + refund), `expireDepartedRequests` (scheduled job), `advanceShipment` (OTP gate, `canMarkPickedUp`), `publishRoute` validations. Signatures `(db, ctx, input)` mutate a `Db` object — wrap with a Firestore-transaction adapter that loads the touched docs into a `Db`-shaped slice, or refactor to explicit reads/writes.
- `dates.ts` (IST helpers), `phone.ts` (`toE164`, Indian mobile), `ids.ts` (`genBookingId` — switch `rand` to `crypto.randomInt` and create-if-absent in a transaction), `constants.ts` (`LIMITS`, `OTP`, `LOGIN_LOCK`), `cities.ts` (`legKm`, haversine fallback — useful until a real distance source), `earnings.ts`, `labels.ts`, `src/lib/format/index.ts`, `src/lib/utils/safe-redirect.ts`, zod schemas in `src/lib/schemas/*`.
- `src/app/api/payments/cashfree/_lib/cashfree-server.ts` — `verifyWebhookSignature` (constant-time), `isFreshTimestamp`, input validators; handlers already ignore client amounts.

**Tests worth keeping (vitest, 52 cases in `tests/unit`):** `pricing.test.ts` (8), `booking-machine.test.ts` (5), `commands.test.ts` (15: request→accept→pay, capacity, publish, OTP pickup, expiry), `integrity.test.ts` (12: Cashfree signature, cross-account, double-submit, departure), `format-and-redirect.test.ts` (4). `seed-and-search.test.ts` (8) is tied to the demo seed — keep the search half, drop seed assertions.

---

## 4. Gaps and risks

### 4.1 Everything that is client-side and must move server-side
- **All business writes**: `marketplace.ts` → `useTakiStore.mutate` (`src/lib/store/index.ts`). Every command runs in the browser on a localStorage copy; two browsers have two databases. Replace with route handlers / server actions using `firebase-admin` + Firestore transactions.
- **All reads**: `selectors.ts` hooks derive from the local `Db`. Need server fetch (RSC or route handlers) per role, scoped to the caller.
- **Auth**: `demo-auth.ts` (OTP generation/verification, password hashing, lockout, session issuance). Session object in localStorage (`partialize.session`).
- **Payments**: `demo-payment.ts` calls `recordPayment` client-side. `payment/index.ts` picks the adapter from a `NEXT_PUBLIC_` flag.
- **Expiry sweep**: `sweepExpired()` runs in the tab; production needs a scheduled job (or lazy evaluation inside every transaction that touches a booking/route).
- **Seed / reseed**: `buildSeed` + `refreshDemoIfStale` + `resetDemo` replace data daily. Rule 4 forbids static mock data as backend substitute → replace with an explicit, dev-only Firestore seed script.
- **Notifications** written client-side by `notify()`.
- **Route drafts** (`routeDraft`) live only in localStorage → v2 "save draft" must be a server `draft` trip.

### 4.2 Security issues (current build; acceptable only as labelled demo)
1. **Forgeable session / role**: `session` in localStorage; `requireRole()` trusts it. No server authZ exists at all.
2. **OTP codes in localStorage**: auth challenge `otp.code` persisted (`index.ts` `partialize`); booking `pickupOtp`/`deliveryOtp` stored in plaintext on the booking in the shared `db` — in the same browser a "driver" can read the customer's OTPs. v2: hash OTPs server-side; only the customer receives plaintext; driver submits for verification.
3. **Password hashes** (salted SHA-256, fast hash) and **all PII** (names, mobiles) of every account in localStorage.
4. **OTP generation** for booking OTPs uses `ctx.rand = Math.random` (`commands.ts:141`); ids too (`ids.ts`). Server must use CSPRNG.
5. **Rate limits** (OTP resend/attempts, login lock) enforced client-side only.
6. **Booking ID** `TAKI` + 6 random digits (900k space) is used as the URL key on tracking/receipt pages (`booking-access.ts` checks ownership client-side). Server must enforce ownership per request; consider longer opaque ids for URLs.
7. **No documents/uploads yet**: v2 adds Aadhaar/PAN/license/photos/delivery proof → need private storage (Firebase Storage or Firestore-referenced private bucket), signed URLs, masking (e.g., Aadhaar last-4), role-restricted access; never via public `/public` paths.
8. **Contacts sharing**: v2 requires customer/receiver phone shared with driver only after acceptance, driver/vehicle shared with customer only after acceptance → field-level projection in API responses.
9. **`server-only`** is imported by `cashfree-server.ts` but not in `package.json` (Next resolves it internally; `vitest.config.mts` aliases it to `node_modules/next/dist/compiled/server-only/empty.js`). Works today; adding the package explicitly is optional but clearer for new server modules.
10. **CSP** (`next.config.ts`) only sets `frame-ancestors/base-uri/form-action/object-src`. Cashfree checkout + Firebase client SDK domains will need `script-src`/`connect-src`/`frame-src` if CSP is tightened. `Permissions-Policy` disables `geolocation` and `camera` — conflicts with "current location" (customer) and possibly delivery-proof capture (driver); must be relaxed to `geolocation=(self)`, `camera=(self)`.
11. **Refunds** are instant status flips (`refundPayments`) — must go through provider and be idempotent.

### 4.3 Data-model mismatches with v2
| v2 concept | Current | Change needed |
|---|---|---|
| Roles customer / agency / driver | `Role = 'customer' \| 'driver'`; `Driver` = owner-operator with `businessName` | Rename current driver → `Agency`; new `Driver` (belongs to agency, docs, photo). Ripples through `Session`, `Notification.recipientRole`, `BookingStatusEvent.by`, nav, paths, tests. |
| Location = full address, district, pincode, state (5 states) | `CityId` from 14 fixed cities (12 TN, 1 KL, 1 KA) in `cities.ts`; distance from a hard-coded km table + haversine×1.25 | Address object `{line, district, pincode, state, lat?, lng?}`. Matching must key on something on the trip path: likely **district** (trip checkpoints = districts). Needs a district dataset for TN/KL/KA/TG/AP and a distance strategy (haversine estimate is OK if labelled). |
| Receiver (name, phone) | none | Add to shipment; private until acceptance. |
| Package type, description, special handling | optional `cargoType` (5 values) only | New fields; package type must map to goods-restriction categories. |
| Goods restrictions on vehicle/trip | none | `acceptedGoods[]`/`restrictedGoods[]` on vehicle + trip; enforced in `offerProblem` and server request validation. |
| Checkpoints with expected timings; arrival time | `stops: {cityId, kmFromOrigin}` (≤5), only `departureTime`; `durationMins` estimated | `checkpoints: {district, km, expectedArrival, expectedDeparture}`; `arrivalAt` on trip. Checkpoint arrival/departure events per shipment/trip. |
| Shipment vs booking | One `Booking` embeds `shipment` (search query) | v2 wants separate shipment + booking + tracking events; at minimum split `trackingEvents` into a subcollection. |
| Vehicle ownership | `Vehicle.driverId` | `Vehicle.agencyId`; `Trip.vehicleId` + `Trip.driverId` with overlap checks for both. |
| Trip status | `draft` (unused) / `published` / `completed` / `cancelled` | Add `active`/in-progress; implement draft + cancel-trip (cancels/refunds bookings). |
| Booking statuses | `awaiting_driver`, `declined`, `pending_payment`, … | Rename for agency (`awaiting_agency` / `rejected`); add checkpoint progress; keep `picked_up`/`in_transit`/`out_for_delivery`/`delivered`. |
| Reviews | `ratingAvg/ratingCount` seeded on `Driver` | `Review {bookingId, customerId, driverId, agencyId, rating, text}`; aggregate on write (transaction). |
| Payments | `mode: 'demo' \| 'live'`, `status initiated/succeeded/failed/refunded` | Add provider order id, server confirmation source (verify/webhook/dev-confirm), settlement status for agency earnings. |
| Earnings / settlements | `EarningEntry.status = 'paid'` on delivery; `archivedMonths` seeded; simulated payouts | Derive from real payments; settlement status (`pending/settled`); drop seeded history. |
| Profiles | `Customer {fullName, mobile}` | Customer DOB, photo; Agency (owner, agency name, district, vehicle range, states, docs, verification status); Driver (DL, Aadhaar, photo, agencyId). |

### 4.4 Test suites that will be invalidated
- **E2E (`tests/e2e`, ~131 tests × 5 viewport projects)**: 10 of 11 spec files read/write localStorage `taki-demo-v1` directly or rely on the seeded demo (39 references) and on testid `demo-otp-code`; demo accounts/password (`DEMO_ACCOUNTS`, `DEMO_PASSWORD` in `seed.ts`/`constants.ts`); "Demo: simulate next update" button; driver-as-operator nav. Expect near-total rewrite: `auth`, `booking`, `booking-flow.ts` helper, `customer-journey`, `customer-search`, `driver-journey`, `driver-requests`, `driver-routes`, `integration`, `payment-tracking`, `responsive-a11y`, `visual`. The a11y/responsive *assertions* (axe, no horizontal scroll, touch targets) are worth porting.
- **Visual baselines** `test-results/visual/*.png` (46 committed; 28 currently modified in the working tree) will all change.
- **Unit**: `seed-and-search.test.ts` seed assertions die with the seed; `commands.test.ts`/`integrity.test.ts` need updates for role rename and new statuses but the scenarios stay valid.
- New suites needed: server route-handler tests (authZ, ownership, validation), Firestore transaction tests for capacity (concurrent accepts), OTP hashing/expiry/rate-limit, payment confirmation idempotency. These need either the emulator (Java) or a test Firebase project, or a repository abstraction with an in-memory implementation for vitest.

---

## 5. Dependency / tooling check

| Item | State | Notes |
|---|---|---|
| Node | v24.20.0, npm 11.19.0 | firebase-tools requires Node ≥ 18 (OK); firebase-admin 13.x requires Node ≥ 18 (OK). |
| Next | 16.4.6 (App Router; Middleware renamed **Proxy** → `src/proxy.ts`; docs in `node_modules/next/dist/docs/01-app/`) | `cacheComponents` intentionally off (`next.config.ts`). Typed `LayoutProps<"/customer">` in use. Read `01-app/02-guides/authentication.md`, `data-security.md`, `backend-for-frontend.md`, `01-getting-started/15-route-handlers.md`, `16-proxy.md` before server work. |
| React 19.3, Tailwind 4.3.3, zustand 5, zod 4, react-hook-form 7, lucide-react | installed | |
| vitest 5, @playwright/test 1.65, @axe-core/playwright | installed | Playwright `webServer` = `npm run start -- -p 3100` (needs a prior `next build`), `reuseExistingServer: true`. |
| `firebase-admin` | **not installed** | Required for server-side Firestore/Auth/Storage. |
| `firebase` (client SDK) | **not installed** | Only needed if using Firebase Auth on the client (phone auth/reCAPTCHA) or client Storage uploads; not needed if server sessions + server OTP. |
| `firebase-tools` (CLI/emulators) | **not installed** (no `firebase` on PATH) | Needed for emulators, rules deploy, indexes. Can be a devDependency + `npx`. |
| Java (JRE 11+, emulators need 11+; recent firebase-tools want 21) | **not installed** (`java: command not found`) | Firestore/Auth/Storage emulators cannot run → options: install Temurin JDK 21, or use a real dev Firebase project via `.env.local`, or an in-memory repository for unit tests. |
| `server-only` | not in `package.json` | Imported by `cashfree-server.ts`; resolved by Next internally and aliased in `vitest.config.mts`. Reuse the same pattern for new server modules. |
| Session/crypto libs (`jose` or `iron-session`) | not installed | Needed if not using Firebase session cookies. `node:crypto` covers scrypt/HMAC/randomInt. |
| `.env.local` | **absent** | `.env.example` lists `NEXT_PUBLIC_APP_MODE`, `NEXT_PUBLIC_FIREBASE_*`, `CASHFREE_*`. Needs server vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (or `GOOGLE_APPLICATION_CREDENTIALS`), `FIRESTORE_EMULATOR_HOST`, session secret, OTP pepper, SMS provider vars. `.gitignore` already ignores `.env*` except `.example`. |
| Other docs | `docs/backend-integration.md` (seams, Firestore collection sketch, Cashfree flow), `docs/planning/data-contract.md` (v1 contract the domain code cites) | Backend doc assumes Cloud Functions + Firebase phone auth; v2 decision is Next route handlers + `firebase-admin` — doc needs updating by P2. |

---

## 6. Known pre-existing E2E failures (do not attribute to v2 work)

| Spec / test | Projects failing | Cause |
|---|---|---|
| `tests/e2e/customer-journey.spec.ts:802` — "sidebar, header, back arrows and footer reach real pages without console errors" | tablet, mobile, small | Sidebar nav is inside `MobileNavDrawer` at these widths; test clicks sidebar links without opening the drawer. |
| `tests/e2e/driver-journey.spec.ts:600` — "sidebar, stat cards and help links reach real pages without console errors" | tablet, mobile, small | Same drawer cause. |
| `tests/e2e/customer-journey.spec.ts:473` — "password rules, mismatch and name required" | laptop | Pre-existing, laptop-only. |

All three predate `cc0d69e` and will be superseded by the E2E rewrite (4.4).
