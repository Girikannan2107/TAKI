# P3: Workflow, UI routes, frontend architecture, monorepo, deployment, test and work plan (v3)

Branch `feat/fastapi-monorepo`. Planning agent P3. Status: proposal for the orchestrator. Owner sign-off is needed on §9.

Scope. This document covers the product workflow end to end, the `apps/web` route inventory, the frontend architecture after the move to FastAPI, the monorepo layout and tooling, deployment (Firebase App Hosting, Cloud Run, Firebase rules), the test plan for T1/T2/T3, and the D1–D5 work breakdown.
Backend internals (Firestore schema, the Python package layout, the state machine port and the API contracts) belong to **P2**. Where this document names a backend endpoint, it uses **today's path**, and the recommendation is that FastAPI keeps those paths (§3.3). P2 is the authority if it decides otherwise.

Facts checked in the repo (2026-11-15):
- Next.js 16.4.6, React 19.3.0, Tailwind 4.3.3, zod 4, react-hook-form. `src/proxy.ts` is the Next 16 replacement for middleware (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). `typedRoutes` is not enabled.
- There are 58 pages under `src/app` and **87 route handlers** under `src/app/api`. `src/server` has 85 files.
- No UI file imports `@/server`, `server-only` or `next/headers`. Every browser call goes through `src/lib/api/http.ts` and the 7 modules in `src/lib/api/client/*`. This boundary makes the cut-over clean.
- Auth today is a custom scrypt + HMAC cookie with server OTPs (`src/server/auth/**`). There is no Firebase Auth.
- Places today come from a curated district/hub dataset (`src/lib/domain/places/*`). Distances are haversine × 1.25. `RouteMap.tsx` is an illustrative SVG, not a map.
- Cashfree JS checkout is **already wired** in the UI (`src/features/payment/cashfree-checkout.ts`, which loads `sdk.cashfree.com/js/v3`). The dev gateway is a separate page (`/customer/payment/dev-gateway`). The npm package `@cashfreepayments/cashfree-js` is a dependency but is not imported.
- Delivery proof upload (1–3 photos + OTP) **already exists** (`ShipmentActionView.tsx`, `driverApi.deliver`).
- Private files are rendered as `<img src="/api/files/<id>">`, which relies on the same-origin cookie. This breaks with bearer tokens (§3.6).
- Design tokens: Cream `#FFF8EF`, Emerald `#087443`, Lime `#C8F56A` in `src/app/globals.css`. **There is no redesign.** Existing components are reused everywhere.
- Local machine: Node 24, **Python 3.14** (3.12 must be installed via `py -3.12`/uv), Java 21 (emulators OK).
- The working tree has 28 modified `test-results/visual/*.png` files. These must be committed or discarded **before** the folder move (§7.1).

---

## 1. Product workflow, end to end

Legend for the **UI** column:
- ✅ exists and works, kept as is
- ✏️ exists but must change
- ➕ missing (new screen or feature)

"API" is the FastAPI endpoint, using today's path. Every call carries `Authorization: Bearer <Firebase ID token>`, except the public ones.

### 1.1 Happy path

| # | Actor | Screen (route) | UI | Backend action |
|---|---|---|---|---|
| 1 | Agency owner | `/signup/agency` (owner, agency name, district, vehicle-count range, states) → `/auth/phone?flow=signup&role=agency` → `/auth/verify-otp` → `/auth/create-password` | ✏️ The phone and OTP steps switch to **Firebase `signInWithPhoneNumber` + invisible reCAPTCHA**. The create-password step calls the new signup endpoint with the ID token. | Client: Firebase phone sign-in. `POST /api/auth/signup/agency` (Bearer, `{password, details}`). The backend checks that the token's `sign_in_provider=phone` and that it is fresh (≤10 min). It sets the synthetic email and password on the Firebase user (§3.4), creates `users/{uid}` and an `agencies/{id}` with status `pending_verification`, sets the custom claim `role=agency`, and returns `SessionUserDTO`. |
| 2 | Agency owner | `/agency/profile/verification?onboarding=1` (Aadhaar/PAN/DL number + front/back + photo) | ✏️ Only the file preview URLs change (§3.6). | `POST /api/agency/verification` (multipart) → Storage (private) + HMAC'd document number. An `agency_submitted` notification goes to admins. |
| 3 | Admin (hidden) | `/admin/login` → `/admin/agencies?status=pending` → `/admin/agencies/[agencyId]` | ✏️ Login switches to Firebase phone + password. The document viewer uses signed file URLs. | `POST /api/admin/agencies/{id}/verify` or `/reject {reason}` → agency `verified` or `rejected`, plus a notification. **An unverified agency can add vehicles and drivers but cannot publish** (unchanged rule). |
| 4 | Agency | `/agency/vehicles/new`, `/agency/vehicles/[vehicleId]` | ✅ (photo previews per §3.6) | `POST/PATCH/DELETE /api/agency/vehicles…`, `POST /api/agency/vehicles/{id}/photos` |
| 5a | Agency | `/agency/drivers/new` (invite by name + phone) | ✅ | `POST /api/agency/driver-invites` |
| 5b | Driver | `/signup/driver` (name, agency or "invited") → phone OTP → password → `/driver/profile/documents?onboarding=1` (DL + Aadhaar + photo) | ✏️ Same Firebase OTP change as step 1 | `POST /api/auth/signup/driver` → the driver links to the invite or to the chosen agency (`pending_agency`). `PUT /api/me/documents/{kind}`, `PUT /api/me/photo` |
| 5c | Agency | `/agency/drivers?tab=pending` → `/agency/drivers/[driverId]` | ✅ | `POST /api/agency/drivers/{id}/approve` or `/reject` |
| 5d | Admin | `/admin/drivers?status=pending` → `/admin/drivers/[driverId]` | ✅ | `POST /api/admin/drivers/{id}/verify` or `/reject` |
| 6 | Agency | **Add Trip step 1** `/agency/trips/new[?draft=]`: vehicle, driver, max/offered capacity, **ordered checkpoints** (source → stops → destination, each with expected arrival/departure), accepted goods, special handling, max package kg, notes | ✏️ The `CheckpointEditor` place `<Select>` becomes a **Google Places Autocomplete** input. Leg distances come from the server via the Routes API (labelled "road distance", not "approx."). | `GET /api/agency/trips/form-options` (vehicles and drivers free in the window, so there are no overlapping assignments). `POST /api/agency/trips/preview` → the backend resolves each Google `placeId` with the Geocoding API (lat/lng, district, state; it rejects places outside TN/KL/KA/TS/AP) and calls **Routes API `computeRoutes` with intermediates** → `kmFromOrigin` per checkpoint plus an encoded polyline. `POST /api/agency/trips` saves a draft. |
| 7 | Agency | **Add Trip step 2** `/agency/trips/new/pricing?draft=`: **cost per km**, **cost per kg**, **additional charges** → Publish or Save draft | ✏️ ➕ The **"Additional charges" repeater is missing**. Today there is only `handlingFeeRupees` (charged only for special handling). Add rows of `{label, amountRupees, appliesTo: "always" \| "special_handling"}`, up to 5. `PricePreview` must render `pricing.lines[]`. | `PATCH /api/agency/trips/{id}` (`ratePerKmPaise`, `ratePerKgPaise`, `additionalCharges[]`) → `POST /api/agency/trips/{id}/publish` (verified agency, lead time ≥60 min, ≤60 days ahead, driver/vehicle free). |
| 8 | Customer | `/signup/customer` (name, **DOB, 18+**, terms) → phone OTP → password → `/customer/dashboard` | ✏️ Firebase OTP | `POST /api/auth/signup/customer`. The backend **re-checks age ≥ 18** from the DOB (the client `max` date is UX only). |
| 9 | Customer (guest allowed until submit) | `/customer/dashboard` quick-ship → `/customer/shipments/new[?from&to&weight&date]` with **source**, **destination**, **receiver** (name, phone, "I am the receiver") and **parcel** (weight, type, description, date, special handling) | ✏️ The "Full address" input becomes **Places Autocomplete**, which prefills line1, district, state and pincode; these stay editable. "Use current location" goes from browser geolocation to **server reverse geocode** (today it is nearest-district only). The district `<Select>` stays as the fallback when Maps fails to load. | `POST /api/customer/shipments` (or `PATCH` with `?edit=`). The backend geocodes the `placeId`, or reverse-geocodes `lat,lng`, via the Geocoding API; derives district and state; validates the pincode against the state; and rejects a source district equal to the destination district. **It refuses if the customer is under 18** (defence in depth). |
| 10 | System | `/customer/vehicles?shipment=<id>` (guests: `?from&to&weight&date`) with filters (vehicle type, price, date, capacity) and sort (price ↑↓, earliest departure/arrival) | ✏️ The card and modal map becomes a **Google map** (§3.7). The `RouteMap` SVG is kept as the fallback. | `GET /api/customer/shipments/{id}/offers` or `GET /api/customer/search`. Matching (P2) works like this. **Exact:** pickup district = trip origin district and drop = trip destination district. **Intermediate:** pickup district = checkpoint *i*, drop = checkpoint *j*, *j > i*, on any of the ordered checkpoints. Then date (IST date of the pickup departure), not departed, goods, handling, per-package kg, and effective capacity. Price = segment km × per-km + kg × per-kg + applicable additional charges + TAKI fee. |
| 11 | Customer | `/customer/booking/[tripId]?shipment=<id>` (vehicle details: overview, driver + reviews, agency, route with checkpoints and times, restrictions, capacity, **line-by-line cost breakdown**) | ✏️ Real map. `BookingSummary` must iterate `pricing.lines` (today it hard-codes distance, weight, handling and fee). | `GET /api/customer/trips/{tripId}?shipmentId=` |
| 12 | Customer | Same page, **Request booking** (a guest is sent to login with `?next=`) | ✅ | `POST /api/customer/bookings {shipmentId, tripId}` + `Idempotency-Key` → `awaiting_agency` with `respondBy = pickup departure − 60 min` → the agency is notified. No capacity is held yet (P2 may change this). |
| 13 | Agency | `/agency/bookings?tab=pending` → `/agency/bookings/[bookingId]` (customer, parcel, segment, price) | ✅ | `POST /api/agency/bookings/{id}/accept` is a **Firestore transaction**. It takes a capacity hold on the trip, sets `pending_payment` and `payBy = min(now + 120 min, departure − 30 min)`, and notifies the customer. `POST …/reject {reason}` sets `rejected` and notifies. |
| 14 | Customer | `/customer/payment?bookingId=` → Cashfree checkout (redirect) → `/customer/payment/return?paymentId=` → `/customer/booking-confirmation?bookingId=` | ✏️ Production uses **Cashfree only**. `PaymentView` already calls `openCashfreeCheckout`. Switch to the official `@cashfreepayments/cashfree-js` `load({mode})` (already a dependency) or keep the script loader. `/customer/payment/dev-gateway` is local/e2e only (§2.1). | `POST /api/payments/orders {bookingId}` + `Idempotency-Key` → Cashfree **Create Order** (`order_amount` computed server-side, `return_url = {APP_ORIGIN}/customer/payment/return?paymentId=…`, `notify_url = {API_PUBLIC_URL}/api/payments/cashfree/webhook`) → `{checkout:{kind:"cashfree", mode, paymentSessionId}}`. The return page polls `GET /api/payments/{id}`; the backend calls Cashfree **Get Order/Payments** before answering. The **webhook** `POST /api/payments/cashfree/webhook` verifies `x-webhook-signature` (HMAC-SHA256 over `timestamp + rawBody`), dedupes on the event/payment id, and moves the booking to `confirmed` with fresh pickup/delivery OTPs. |
| 15 | Agency → Driver | Driver chosen per **trip** in step 6. Reassign on `/agency/trips/[tripId]`. The driver sees the booking in `/driver/shipments` from `confirmed` | ✅ | `POST /api/agency/trips/{id}/reassign {driverId}` (no overlap). The customer and receiver contact are visible to the driver only from `confirmed`; driver and vehicle details are visible to the customer from `pending_payment` (acceptance). |
| 16 | Driver | `/driver/trips/[tripId]` (start trip = depart checkpoint 0) and `/driver/shipments/[bookingId]` → **Confirm pickup** with the customer's pickup code (or refuse with a reason) | ✅ | `POST /api/driver/shipments/{id}/pickup {otp}` → `picked_up`. `POST …/refuse-pickup` → `cancelled` (+ refund). `POST …/start-transit` → `in_transit` |
| 17 | Driver | `/driver/trips/[tripId]` → **Arrived / Departed** per checkpoint | ✅ | `POST /api/driver/trips/{id}/checkpoints/{i}/arrive` and `/depart` → server-timestamped tracking events, fanned out to every booking on the trip. The customer sees them on `/customer/tracking/[bookingId]` (polling). |
| 18 | Driver | `/driver/shipments/[bookingId]` → **Out for delivery** → **Deliver**: receiver's code + 1–3 **proof photos** (camera) + received-by + remarks | ✏️ Exists. Only the file previews change (§3.6). | `POST …/out-for-delivery`. `POST …/deliver` (multipart → Storage, magic-byte and size checks) → `delivered`, notifying the customer and the agency. `POST /api/driver/trips/{id}/complete` when every booking is terminal. |
| 19 | Customer | `/customer/tracking/[bookingId]` → "How was your delivery?" (rating 1–5 + comment). `/customer/receipt/[bookingId]` | ✅ customer side. ➕ **The agency cannot see its reviews** (`reviewsApi.forAgency` is unused): add a Reviews card to `/agency/profile` | `POST /api/customer/bookings/{id}/review` (one per booking, delivered only) → driver and agency rating aggregates |
| 20 | Admin | `/admin/settlements` | ✅ | `GET/POST /api/admin/settlements` (read-only earnings; ops marks them settled) |

### 1.2 Exception paths

| Path | Actor / screen | UI | Backend |
|---|---|---|---|
| **Customer cancels before pickup** | Customer, `/customer/tracking/[bookingId]` (`CancelPaidBooking`), also from `/customer/shipments` | ✅ | `POST /api/customer/bookings/{id}/cancel {reason?}` allowed only in `awaiting_agency`, `pending_payment`, `payment_failed` or `confirmed`. The capacity hold is released. If it was paid, a refund job runs Cashfree **Create Refund** (idempotent `refund_id = booking id`) → `refund_pending → refunded`, and the `REFUND_STATUS_WEBHOOK` is handled. |
| **Withdraw an unbooked shipment** | `/customer/shipments` | ✅ | `DELETE /api/customer/shipments/{id}` |
| **Agency rejects** | `/agency/bookings/[id]` | ✅ | `→ rejected`, the customer is notified, and `/customer/shipments?tab=rejected` shows the reason plus "Find another vehicle" (`/customer/vehicles?shipment=`). |
| **Agency cancels or unpublishes a trip** | `/agency/trips/[tripId]` | ✅ | `POST …/cancel {reason}`: every open booking goes `awaiting_agency → rejected` and the others `→ cancelled` + refund. `…/unpublish` is allowed only with no open bookings. |
| **Request expiry** (agency did not answer by `respondBy`) | none (system) | ✅ the status shows | **Cloud Scheduler → `POST /api/internal/sweep`** every 5 min (OIDC-authenticated, §5.3) → `expireRequest → rejected (reason: expired)` plus notifications. |
| **Payment window expiry** | none (system) | ✅ | Same sweep: `expirePayment → cancelled`, hold released. A late Cashfree success after the expiry is **auto-refunded** (webhook handler). |
| **Failed payment and retry** | `/customer/payment/return` shows "Payment failed" + **Try again** → `/customer/payment?bookingId=` | ✅ (exists for the dev gateway; verify it with Cashfree failure and user-dropped) | A `PAYMENT_FAILED` or `PAYMENT_USER_DROPPED` webhook, or a Get Order showing failure → `payment_failed`. Retrying creates a new order (new idempotency key, same booking) → `retryPayment → pending_payment`. The hold stays until `payBy`. |
| **Pickup refused** (goods do not match, etc.) | Driver, `/driver/shipments/[id]` | ✅ | `refuse-pickup → cancelled` + refund (the policy on who bears the fee is an owner question, §9). |
| **Wrong pickup or delivery code** | Driver | ✅ | 5 attempts, then the customer regenerates the code: `POST /api/customer/bookings/{id}/otp/regenerate`. |

### 1.3 Missing screens and features (summary)

| # | Missing | Where | Owner |
|---|---|---|---|
| M1 | **Firebase phone OTP + reCAPTCHA** in signup, password reset and phone change; phone + password login through Firebase | `(auth)` views, `ChangePhoneCard`, `AdminLoginView` | D1 |
| M2 | **Google Places Autocomplete** for shipment addresses and trip checkpoints, and **reverse geocode** for "current location" | `NewShipmentView`, `CheckpointEditor` | D5 (component) + D4/D3 (integration) |
| M3 | **Real Google map** (route polyline + stop markers) on vehicle cards, vehicle details and tracking | `RouteMap` callers | D5 + D4 |
| M4 | **Additional charges** in the trip pricing step, and line-driven price breakdowns everywhere | `SetPricingView`, `PricePreview`, `BookingSummary`, `BookingDetailsView`, `ReceiptView`, `TripDetailsView` | D3 (agency) + D4 (customer views) |
| M5 | **Legal pages**: Terms, Privacy, **Refund & Cancellation**, Shipping/Delivery policy, Contact. **Cashfree merchant activation requires these to be live on the site.** Today the signup checkbox mentions Terms/Privacy, but no page exists. | new `(public)` routes + footer links | D1 |
| M6 | Agency **Reviews** card on the profile | `/agency/profile` | D3 |
| M7 | Admin **Payments & refunds** list (payment status, webhook received, refund status, retry a stuck refund) and **booking lookup** for support | `/admin/payments`, `/admin/bookings/[bookingId]` | D2 (API) + D1 (UI) |
| M8 | "Account setup incomplete" handling: a Firebase user with no TAKI profile (OTP verified, password step abandoned) | `/auth/create-password` resume | D1 |

---

## 2. UI route inventory (`apps/web`)

All routes keep their current paths, so `src/lib/config/routes.ts` (`paths`) stays the single builder. "Guard" is client-side UX only (`RequireRole` / `GuestOnly`). **FastAPI enforces every rule.**

### 2.1 Public, auth, legal

| Path | Purpose | Data | Guard | Status |
|---|---|---|---|---|
| `/` | Landing (hero, how it works, benefits, goods, about, contact) | `POST /api/public/contact` | none | keep |
| `/terms`, `/privacy`, `/refund-policy`, `/shipping-policy` | Legal (needed for Cashfree KYC) | static MDX/TSX | none | **new** |
| `/signup` | Role selection | none | `GuestOnly` | keep |
| `/signup/customer` | Name, DOB 18+, terms → flow store | none | `GuestOnly` | keep |
| `/signup/agency` | Owner, agency, district, range, states | `GET /api/geo/districts` (public) | `GuestOnly` | keep |
| `/signup/driver` | Name, agency picker or "invited" | `GET /api/public/agencies` | `GuestOnly` | keep |
| `/auth/phone?flow=signup\|reset&role=` | Phone entry + **invisible reCAPTCHA** → Firebase sends the SMS | Firebase Auth | `GuestOnly` | **change** |
| `/auth/verify-otp?flow&role` | 6-digit code → `PhoneAuthProvider.credential(verificationId, code)` → `signInWithCredential`; resend re-runs reCAPTCHA; "Dev OTP" UI removed; "attempts left" copy replaced by Firebase error mapping | Firebase Auth; `GET /api/me` (registered?) | `GuestOnly` (must allow a **phone-verified user without a profile**) | **change** |
| `/auth/create-password?flow&role` | Signup: password + confirm → `POST /api/auth/signup/{role}`. Reset: new password → `POST /api/auth/password/reset` | Bearer | `GuestOnly` + needs a fresh phone credential | **change** |
| `/auth/login?role=&next=&switch=` | Role tabs; phone + password → `signInWithEmailAndPassword(syntheticEmail(phone), pw)` → `GET /api/me` → role check | Firebase Auth + `/api/me` | `GuestOnly` | **change** |
| `/admin/login?next=` | Same mechanism; non-admin role → sign out + generic error | same | `GuestOnly` | **change** |
| `not-found`, `error`, `loading` | Branded states | none | none | keep |

### 2.2 Customer (`/customer/*`, `DashboardShell role="customer"`, `RequireRole role="customer" guestPaths=[dashboard, vehicles, booking/]`)

| Path | Purpose | Data (API) | Guard | Status |
|---|---|---|---|---|
| `/customer` | → dashboard (server `redirect`) | none | none | keep |
| `/customer/dashboard` | Welcome, counts, recent, quick ship | `GET /customer/dashboard` (guest: quick-ship only) | guest OK | keep |
| `/customer/shipments/new[?from&to&weight&date&edit&trip]` | New shipment form | `GET /me/profile`, `POST/PATCH /customer/shipments`, Places | customer | **change** (Places, reverse geocode) |
| `/customer/vehicles?shipment=…\|from&to&weight…` | Offers + filters + sort + map modal | `GET …/offers` or `GET /customer/search` | guest OK | **change** (Google map) |
| `/customer/booking/[tripId]?shipment=` | Vehicle details + request | `GET /customer/trips/{id}`, `POST /customer/bookings` | guest view, customer to request | **change** (map, price lines) |
| `/customer/payment?bookingId=` | Summary + Pay (Cashfree) | `GET /customer/bookings/{id}`, `POST /payments/orders` | customer | **change** (Cashfree only in prod; copy "demo — no money moves" removed) |
| `/customer/payment/return?paymentId=` | Polls the verified status | `GET /payments/{id}` | customer | keep |
| `/customer/payment/dev-gateway` | Fake gateway for local/e2e | `POST /payments/dev/confirm` | customer | **change**: `notFound()` unless `NEXT_PUBLIC_ENABLE_DEV_GATEWAY=true` (never set in staging or prod) |
| `/customer/booking-confirmation?bookingId=` | Post-payment confirmation | `GET /customer/bookings/{id}` | customer | keep |
| `/customer/shipments?tab=` | Tabs: pending…cancelled | `GET /customer/bookings`, `/counts`, `/customer/shipments` | customer | keep |
| `/customer/tracking/[bookingId]` | Details, OTPs, timeline, cancel, review | `GET /customer/bookings/{id}`, `/tracking` | customer | **change** (map, signed proof URLs) |
| `/customer/receipt/[bookingId]` | Receipt | `GET /customer/bookings/{id}` | customer | **change** (price lines) |
| `/customer/payments` | Payment history | `GET /customer/payments` | customer | keep (copy "demo payments" removed) |
| `/customer/profile` | Details, photo, password, phone change | `/me/*` | customer | **change** (Firebase re-auth + phone update) |

### 2.3 Agency (`/agency/*`, `RequireRole role="agency"`)

| Path | Purpose | Data | Status |
|---|---|---|---|
| `/agency` → `/agency/dashboard` | KPIs, active trips, pending bookings, revenue | `GET /agency/dashboard` | keep |
| `/agency/vehicles`, `/new`, `/[vehicleId]` | Fleet CRUD + photos | `/agency/vehicles*` | keep (file URLs) |
| `/agency/drivers?tab=active\|pending`, `/new`, `/[driverId]` | Drivers, invites, approve/reject, availability | `/agency/drivers*`, `/agency/driver-invites*` | keep (file URLs) |
| `/agency/trips/new[?draft]` | Add Trip step 1 | `form-options`, `preview`, `POST/PATCH trips` | **change** (Places in `CheckpointEditor`, Routes distances, polyline preview map) |
| `/agency/trips/new/pricing?draft` | Add Trip step 2 | `PATCH trips`, `publish` | **change** (additional charges, line preview) |
| `/agency/trips?tab=&published=` | Trip lists | `GET /agency/trips` | keep |
| `/agency/trips/[tripId]` | Trip detail, capacity, bookings, cancel, unpublish, reassign | `GET /agency/trips/{id}` … | **change** (show additional charges, map) |
| `/agency/bookings?tab=`, `/[bookingId]` | Accept/reject | `/agency/bookings*` | **change** (price lines) |
| `/agency/history?q&type&from&to` | Search | `GET /agency/history` | keep |
| `/agency/earnings?tab=` | Read-only earnings and settlements | `GET /agency/earnings` | keep |
| `/agency/profile` | Agency details, verification status, password, phone | `/agency/profile`, `/me/*` | **change** (Firebase phone change; ➕ Reviews card) |
| `/agency/profile/verification[?onboarding=1]` | Documents | `POST /agency/verification` | keep (file URLs) |
| `/agency/help` | FAQ | static | keep |

### 2.4 Driver (`/driver/*`, mobile-first, `RequireRole role="driver"`)

| Path | Purpose | Data | Status |
|---|---|---|---|
| `/driver` → `/driver/dashboard` | Current trip, pickups, in transit, done | `GET /driver/dashboard` | keep |
| `/driver/shipments?tab=pickup\|transit\|delivered` | Assigned shipments | `GET /driver/shipments` | keep |
| `/driver/shipments/[bookingId]` | Pickup / transit / out for delivery / deliver with proof / remarks | `/driver/shipments/{id}/*` | keep (proof preview per §3.6) |
| `/driver/trips/[tripId]` | Checkpoint arrive/depart, complete | `/driver/trips/{id}/*` | keep (optional Google map) |
| `/driver/history?q&month`, `/driver/history/[bookingId]` | Records | `GET /driver/history` | keep |
| `/driver/profile`, `/driver/profile/documents[?onboarding=1]` | Profile, agency link, reviews, documents | `/driver/profile`, `/driver/agency-link`, `/me/*` | **change** (Firebase phone/password) |

### 2.5 Admin (hidden; `robots: noindex`; `RequireRole role="admin"`)

| Path | Purpose | Status |
|---|---|---|
| `/admin` | Overview counts | keep |
| `/admin/agencies?status=`, `/admin/agencies/[agencyId]` | Verify/reject agencies, documents | keep (file URLs) |
| `/admin/drivers?status=`, `/admin/drivers/[driverId]` | Verify/reject drivers | keep |
| `/admin/settlements` | Mark settled | keep |
| `/admin/payments?status=` | Payments, webhooks seen, refunds, retry refund | **new** (M7) |
| `/admin/bookings/[bookingId]` | Support lookup (status history, payment, events) | **new** (M7) |

### 2.6 Removed

| Item | Why |
|---|---|
| `src/app/api/**` (87 handlers) | Replaced by FastAPI |
| `src/proxy.ts` | Cookie gate; there is no cookie any more (§3.5) |
| `next.config.ts` `redirects()` for `/driver/routes…` → `/agency/…` | One-release legacy redirects. There are no production users and the database starts empty. **Remove** (owner may veto, §9). |
| "Dev OTP" banners, `DemoBanner.tsx` (unused), `NEXT_PUBLIC_APP_MODE`/`isDemo` | Firebase OTP replaces the dev OTP. Use `NEXT_PUBLIC_APP_ENV` instead. |

### 2.7 Nav config changes (`src/lib/config/nav.ts`, `routes.ts`)

- `routes.ts`: add `paths.legal = { terms: "/terms", privacy: "/privacy", refund: "/refund-policy", shipping: "/shipping-policy" }`, `paths.admin.payments(status?)` and `paths.admin.booking(id)`. Remove nothing else.
- `adminNav`: add `{ label: "Payments", href: paths.admin.payments(), icon: CreditCard, matchPrefixes: ["/admin/payments", "/admin/bookings"] }`.
- `customerNav`, `agencyNav`, `driverNav`: **no change** (all targets exist).
- `SiteFooter`: add a "Legal" column (Terms, Privacy, Refund & Cancellation, Shipping) and a contact email/phone (Cashfree checks these). `TermsCheckbox`: link the words "Terms of Service" and "Privacy Policy" (`target="_blank"`).
- `roleForPath`, `dashboardFor`, `loginFor`, `safeRedirect`: unchanged. They are still used by `RequireRole`/`GuestOnly`.

---

## 3. Frontend architecture after the move

### 3.1 Layout inside `apps/web/src`

```
src/
  app/                 # pages only (no api/ folder, no proxy.ts)
  components/          # ui/, layout/, brand/ (unchanged) + maps/ (new, D5)
  features/            # unchanged feature folders (+ legal/ new)
  lib/
    api/
      http.ts          # CHANGED: base URL + bearer + 401 retry
      client/*.ts      # unchanged signatures (paths stay /api/...)
      contracts/*.ts   # DTO types + zod form schemas (kept; server-only bits deleted)
      generated/openapi.d.ts   # NEW, generated from FastAPI /openapi.json (drift check in CI)
    firebase/
      client.ts        # NEW: initializeApp + getAuth + emulator wiring
    auth/
      session.ts       # MOVED from features/auth/session.ts (re-export kept)
      phone-otp.ts     # NEW: reCAPTCHA + signInWithPhoneNumber / verify / resend
      password.ts      # NEW: syntheticEmail(), loginWithPassword(), reauth helpers
      errors.ts        # NEW: Firebase error code → user message
    maps/
      loader.ts        # NEW (D5): @googlemaps/js-api-loader singleton
    config/ domain/ format/ schemas/ utils/   # domain/ pruned to display-only helpers (§3.9)
```

### 3.2 Firebase JS SDK initialisation

`src/lib/firebase/client.ts` is the only module that imports `firebase/*`. It imports **only** `firebase/app` and `firebase/auth`; the browser never touches Firestore or Storage.

```ts
"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};
let auth: Auth | null = null;
export function firebaseAuth(): Auth {
  if (auth) return auth;
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = "en";
  const emu = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST; // "127.0.0.1:9099" locally only
  if (emu) {
    connectAuthEmulator(auth, `http://${emu}`, { disableWarnings: true });
    auth.settings.appVerificationDisabledForTesting = true; // reCAPTCHA bypass in emulator/e2e only
  }
  void setPersistence(auth, browserLocalPersistence);
  return auth;
}
```

- The config values are inlined at **build time** (`NEXT_PUBLIC_*`, see `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`), so App Hosting must expose them with `availability: [BUILD, RUNTIME]` (§5.1).
- New dependencies: `firebase` (v12) and `@googlemaps/js-api-loader`. Removed: `firebase-admin`, `server-only`, `tsx`. `firebase-tools` moves to the root package.json.

### 3.3 API client: `http.ts` and the ID token

Recommendation for P2: **FastAPI serves the same paths as today (`/api/...`)** with the same JSON shapes (camelCase via Pydantic `alias_generator=to_camel`) and the same error body `{ error: { code, message, fields?, details? } }`. Then the 7 `client/*.ts` modules and every view stay unchanged, and only `http.ts` changes:

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!; // http://127.0.0.1:8000 | https://api.<domain>

async function authHeader(force = false): Promise<Record<string, string>> {
  const user = firebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken(force)}` }; // SDK caches; auto-refreshes ~5 min before expiry
}

async function request<T>(method, path, body, opts = {}, retried = false): Promise<T> {
  const headers = { accept: "application/json", ...(await authHeader(retried)), ...opts.headers };
  // … same body/idempotency handling as today …
  const res = await fetch(API_BASE + withQuery(path, opts.query), { method, headers, body: payload, credentials: "omit", cache: "no-store", signal: opts.signal });
  if (res.status === 401 && !retried && firebaseAuth().currentUser) return request(method, path, body, opts, true); // one forced refresh
  if (!res.ok) throw await parseError(res);   // unchanged
  …
}
```

- `credentials: "omit"`: there are no cookies, so there is no CSRF surface. The `Origin` checks in today's handler go away. CORS on FastAPI allows `Authorization, Content-Type, Idempotency-Key` and exposes `Retry-After`.
- After a second 401 (`unauthenticated`, `token_revoked`), `http.ts` calls `onUnauthenticated()`, which signs out and lets `RequireRole` redirect to login with `?next=`.
- A new error code `profile_missing` (404 from `/api/me`) means "Firebase user without a TAKI profile". The session store treats it as `incomplete` (§3.4).
- Multipart uploads stay `FormData` → FastAPI `UploadFile`. Request max is 20 MB; the Cloud Run HTTP/1 limit is 32 MB.

### 3.4 Auth flows with Firebase (phone OTP signup/reset, phone + password daily login)

Firebase has no native "phone + password" provider. The design that keeps today's UX:

- Every account is **one Firebase user** with two providers: `phone` (verified by SMS OTP) and `password`, using a **deterministic synthetic email** `syntheticEmail("+919876543210") = "p919876543210@" + NEXT_PUBLIC_AUTH_PHONE_EMAIL_DOMAIN` (a domain the owner controls; no mail is ever sent). There is no lookup endpoint, so there is no phone-number enumeration.
- **The backend owns the password**. After a fresh phone sign-in, FastAPI sets `email` and `password` on the user with the Admin SDK and enforces today's password policy (`password-rules.ts` → Python). The client never calls `updatePassword`.
- **Role** comes from the custom claim `role` set by the backend plus the `users/{uid}` document. After signup the client calls `getIdToken(true)` to pick up the claim.

| Flow | Client steps | Backend |
|---|---|---|
| **Signup** | details (flow store, unchanged) → `/auth/phone`: `new RecaptchaVerifier(auth, "recaptcha-anchor", {size:"invisible"})` → `signInWithPhoneNumber(auth, "+91"+mobile, verifier)` → store `confirmation.verificationId` in the flow store (replacing `challengeId`) → `/auth/verify-otp`: `signInWithCredential(PhoneAuthProvider.credential(verificationId, code))` → `GET /api/me`: a **200** means the number is already registered (sign out, "This number already has an account — log in"); a **404 `profile_missing`** means continue → `/auth/create-password` → `POST /api/auth/signup/{role}` → `getIdToken(true)` → `setSessionUser(user)` → redirect as today (`afterSignupPath`) | Verify the ID token: `firebase.sign_in_provider == "phone"`, `auth_time` ≤ 10 min, `phone_number` present. Create the profile, set email + password + claim. Reject a duplicate profile (409 `phone_taken`). |
| **Daily login** | `signInWithEmailAndPassword(auth, syntheticEmail(phone), pw)` → `GET /api/me` → if the role ≠ the selected tab, keep today's "switch tab" message (the user is signed in, so offer to continue as that role); if the role is `admin` on the public page, `signOut` + generic error | `GET /api/me`. Suspended or rejected accounts return 403 `account_disabled`. |
| **Forgot password** | `/auth/phone?flow=reset` → OTP (as in signup) → `GET /api/me` (404 → "No account for this number", sign out) → `/auth/create-password?flow=reset` → `POST /api/auth/password/reset {password, confirmPassword}` → `signOut` → `/auth/login?role=` | Fresh phone token required. `update_user(password)` + `revoke_refresh_tokens(uid)` (logs out other devices) |
| **Change phone** (profile) | `reauthenticateWithCredential(EmailAuthProvider.credential(syntheticEmail(old), currentPw))` → `PhoneAuthProvider(auth).verifyPhoneNumber("+91"+new, verifier)` → OTP → `updatePhoneNumber(user, cred)` → `POST /api/me/phone` | Reads the new `phone_number` from a fresh token. Updates the synthetic email, `users/{uid}.phone` and denormalised copies. Rejects a number already in use. |
| **Change password** | `reauthenticateWithCredential(…currentPw)` → `POST /api/me/password {password, confirmPassword}` | `auth_time` ≤ 5 min required. Sets the password and revokes other sessions. |
| **Logout** | `signOut(auth)` → `clearSession()` → `/` (same `useLogout` hook) | none (optional `POST /api/auth/logout` to revoke all sessions = "log out everywhere") |

UI details:
- `PhoneView` and `VerifyOtpView` each render a `<div id="recaptcha-anchor" />`. A verifier is created per attempt and cleared on unmount (`verifier.clear()`).
- Resend = a new `signInWithPhoneNumber` call (Firebase throttles it). Keep the 30 s cooldown UI.
- Map errors in `lib/auth/errors.ts`:
  - `auth/invalid-verification-code` → "That code is incorrect"
  - `auth/code-expired` → start over
  - `auth/too-many-requests` → "Too many attempts, try later"
  - `auth/invalid-phone-number`
  - `auth/captcha-check-failed`
  - `auth/quota-exceeded`
  - `auth/invalid-credential` → generic "Phone or password is incorrect"
- `OtpChallengeDTO`, `OtpVerifyResultDTO`, `proofToken` and the "attempts left" counter are deleted from `contracts/auth.ts` and `flow-store.ts`. `auth.spec.ts` tests are updated accordingly.
- Orphan Firebase users (phone verified, signup abandoned) are harmless: retrying signup resumes. P2 adds an optional weekly cleanup job for those older than 7 days.

### 3.5 Session store, role guards, `proxy.ts`

- `useAppSession()` (moved to `lib/auth/session.ts`) keeps its exact public shape, so `useShellSession`, `RequireRole`, `GuestOnly`, `DashboardShell`, `TopBar` and `useLogout` are **unchanged**. Only the source changes:
  - `onIdTokenChanged(firebaseAuth(), async (u) => { if (!u) emit({status:"ready", user:null}); else emit({status:"ready", user: await authApi.me() }) })`
  - Add `status: "incomplete"` when `/api/me` returns `profile_missing`. `GuestOnly` treats `incomplete` as signed out, so the signup flow can finish; `RequireRole` treats it as signed out too.
  - Auth state is shared across tabs (IndexedDB persistence). Logout in one tab signs out all tabs.
- **Role guards are UX only.** `RequireRole` shows `DashboardSkeleton` until `ready`, sends signed-out users to `loginFor(role, next)` and wrong roles to their own dashboard with a toast (unchanged). FastAPI checks the verified token + role + ownership on every request.
- **`src/proxy.ts` is deleted.** There is no server-readable credential (Firebase tokens live in IndexedDB), and a cookie hint would be forgeable, so a server gate adds nothing. The existing page-level guards already render skeletons and redirect. `tests/unit/server/auth/proxy.test.ts` is deleted. Server `redirect()` index pages (`/customer`, `/agency`, `/driver`) stay.
- The cookie session (`taki_session`), `/api/auth/session` and `SESSION_SECRET` are all removed.

### 3.6 Private files (documents, photos, delivery proof)

`<img>` cannot send `Authorization`. Recommendation for P2/D2: DTOs return **short-lived, backend-signed absolute URLs**:

`{API_PUBLIC_URL}/api/files/{fileId}?exp=<unix>&sig=<HMAC(FILE_URL_SIGNING_KEY, fileId|exp|uid)>`

- TTL is 5 min for identity documents and 30 min for photos and proof. FastAPI streams the file from Storage with `Cache-Control: private, no-store` (documents) and checks the signature, the expiry and that the file still belongs to someone the caller may see.
- This works the same on the emulator and in production, needs no `iam.signBlob`, and leaves `<img src>` code unchanged.
- Frontend changes:
  - `Avatar` (the `src.startsWith("/api/")` branch becomes "absolute URL → plain `<img>`, never `next/image`")
  - the `FileUpload` comments
  - reloading a view after the URL expires: `useFileUrl` is not needed, because views refetch DTOs on mount
- Vehicle photos shown to guests in search can use the same mechanism with a longer TTL.

### 3.7 Google Maps in the browser (D5 builds; D3/D4 integrate)

- `lib/maps/loader.ts`: one `Loader({ apiKey: NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, version: "weekly", region: "IN", language: "en-IN" })`, `importLibrary("places" | "maps" | "marker")`. If the key is missing or loading fails, it resolves to `null`.
- `components/maps/PlaceAutocompleteInput.tsx` uses Places API (New) `AutocompleteSuggestion` with a session token, `includedRegionCodes: ["in"]` and a `locationRestriction` bounding the 5 states. It is styled with the existing `Input` (no Google widget styling) and is keyboard and screen-reader accessible (listbox pattern).
  - `onSelect({ placeId, description, sessionToken })`. Only the `placeId` (+ display text) is sent to FastAPI; **the server resolves the coordinates and district**.
  - Fallback: plain `Input` + district `Select` (today's UI) when the loader returns `null`. This also keeps e2e independent of Google.
- `components/maps/GoogleRouteMap.tsx` has the same props as `RouteMap` plus `polyline?: string` (encoded, from the trip DTO). It draws a `Polyline` + `AdvancedMarkerElement` stop pins (needs `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`) with emerald `#087443` route styling. It **falls back to the SVG `RouteMap`**. The caption stays "Planned route — not live location" (there is no GPS).
- "Use current location": `navigator.geolocation` → `GET /api/geo/reverse?lat&lng` (server Geocoding) → prefill.
- CSP note: today's CSP has no `script-src`/`connect-src`, so Maps, reCAPTCHA (`www.google.com`, `www.gstatic.com`) and Cashfree load fine. If a full CSP is added later, allow `maps.googleapis.com maps.gstatic.com places.googleapis.com www.google.com www.gstatic.com sdk.cashfree.com identitytoolkit.googleapis.com securetoken.googleapis.com {API_BASE}`. Keep `Permissions-Policy camera=(self) geolocation=(self) payment=(self)`.

### 3.8 Loading, error and empty conventions (unchanged, re-stated)

- Every data view: a skeleton (`Skeleton`, `DashboardSkeleton`, per-feature `*Skeleton`) → `EmptyState` → content. Errors use `LoadError` (customer), `states.tsx` (agency) or `parts.tsx` (driver) with **Retry**. Mutations use `Button loading` + `useToast` and show field errors from `ApiError.fields` beside the inputs.
- `errorMessage(e)` and `messageForCode(code)` stay the single mapping. New codes to add: `profile_missing`, `account_disabled`, `token_revoked`, `maps_unavailable`, `place_out_of_area`, `payment_provider_error`.
- `network_error` (offline) keeps today's copy.

### 3.9 Files deleted from the frontend (at cut-over, §7)

- `src/server/**` (85 files), `src/app/api/**` (87), `src/proxy.ts`, `src/instrumentation.ts`
- `scripts/{seed.ts,ops.ts,sweep.ts,seed/}` (ported to Python)
- `tests/unit/server/**`, `tests/support/{harness,memory-docstore,memory-filestore,world}.ts`, `vitest.emulator.config.mts`
- `src/features/auth/flow-store.ts`: OTP/proof fields only
- `src/lib/domain/{booking-machine,capacity,segments,trip-rules}.ts`: **authoritative logic moves to Python**. Before deleting them, replace the imports in `VehiclesView`, `AddRouteView`, `RouteCard`, `HelpView`, `SetPricingView` and `PricePreview` with DTO fields or labels (e.g. the trip `preview` endpoint returns the earnings preview). Keep pure display helpers: `model.ts` (types), `dates.ts`, `vehicles.ts` (labels), `phone.ts`, `constants.ts` (UI limits), and `places/districts.ts` (agency signup district list; could later come from `GET /api/geo/districts`). Also keep `OFFER_PROBLEM_MESSAGE` (move it into `features/customer-search/labels.ts`).
- In `contracts/*.ts`, delete server-only parsing helpers. Keep the DTO types + zod **form** schemas, and add `generated/openapi.d.ts` with a CI drift check (`openapi-typescript` against FastAPI's `/openapi.json`, then `tsc` on a `contract-check.ts` that asserts the hand-written DTOs are assignable).
- `package.json`: remove `firebase-admin`, `server-only`, `tsx`, `firebase-tools` (to root) and the `seed`/`ops`/`sweep`/`emulators`/`test:emulator`/`rules:deploy` scripts.

---

## 4. Monorepo and tooling

### 4.1 Final tree

```
d:\urgent\
├─ apps/
│  └─ web/                          # Next.js 16.4 app (moved from repo root with git mv)
│     ├─ src/ public/ tests/{e2e,unit,support}
│     ├─ test-results/visual/       # committed baselines (moved)
│     ├─ apphosting.yaml            # production; apphosting.staging.yaml (optional env override)
│     ├─ package.json  package-lock.json
│     ├─ next.config.ts  tsconfig.json  eslint.config.mjs  postcss/next-env.d.ts
│     ├─ vitest.config.mts  playwright.config.ts
│     ├─ .env.example  .env.development   # NEXT_PUBLIC_* only
│     └─ AGENTS.md                  # next dev (re)writes it in the project dir
├─ backend/                         # FastAPI (internal layout per P2)
│  ├─ app/  (main.py, api/, core/, services/, repos/, …)
│  ├─ tests/
│  ├─ scripts/  seed_emulator.py  create_admin.py  ops.py
│  ├─ pyproject.toml  requirements.txt  requirements-dev.txt
│  ├─ Dockerfile  .dockerignore  .env.example
├─ firebase/
│  ├─ firebase.json  .firebaserc  firestore.rules  firestore.indexes.json  storage.rules
├─ scripts/   dev.mjs  setup.mjs  e2e.mjs  shot.mjs
├─ docs/      planning/ v3/ qa/ DEMO_LOGINS.md (rewritten for emulator + Firebase test numbers)
├─ .github/workflows/  ci.yml  deploy-backend.yml  deploy-firebase.yml
├─ references/  TAKI_website_assets/  TAKI_Website_Images_Original_Logo/  Reference.jpeg   # unchanged
├─ package.json            # root: tooling only, NO workspaces
├─ AGENTS.md               # short: "web app is apps/web (see apps/web/AGENTS.md); backend is backend/"
├─ README.md  .gitignore
```

### 4.2 Recommendation: no npm workspaces

- `apps/web` keeps **its own `package.json` + `package-lock.json`**. App Hosting builds `rootDirectory: apps/web` with a plain `npm ci && npm run build`. It has no workspace hoisting to reason about, and the Python backend has nothing to share with npm.
- The root `package.json` (`"private": true`, no `workspaces`) holds tooling only: `devDependencies: { "firebase-tools": "^15" }`, plus scripts:
  - `"setup": "node scripts/setup.mjs"`: creates `backend/.venv` with Python 3.12, `pip install -r backend/requirements-dev.txt`, then `npm ci --prefix apps/web`
  - `"dev": "node scripts/dev.mjs"`
  - `"emulators": "firebase emulators:start --config firebase/firebase.json --project demo-taki --only auth,firestore,storage --import=.data/emulators --export-on-exit"`
  - `"e2e": "node scripts/e2e.mjs"`
  - `"rules:deploy": "firebase deploy --config firebase/firebase.json --only firestore:rules,firestore:indexes,storage"`
- Two lockfiles make Turbopack guess the workspace root. **Pin it** in `apps/web/next.config.ts`: `turbopack: { root: path.join(__dirname), rules: {…} }` (see `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md`, "root").

### 4.3 Aliases and configs that survive the move

- `tsconfig.json` moves as is. `paths: { "@/*": ["./src/*"] }` is relative to `apps/web`, so **no import changes**.
- `vitest.config.mts` keeps the `@` alias (`path.resolve(__dirname, "src")`). Drop the `server-only` alias. `include: ["tests/unit/**/*.test.ts"]`, `environment: "node"` (add `jsdom` per file where a hook test needs it).
- `eslint.config.mjs`: drop the ignores for root asset folders (they are outside `apps/web`) and keep `.next/**`, `test-results/**`, `playwright-report/**`.
- `next-env.d.ts`, `.next/`, `tsconfig.tsbuildinfo`: regenerated inside `apps/web`.
- `firebase.json` moves to `firebase/`. Rules paths are relative to it (`"rules": "firestore.rules"`). It adds `"auth": { "port": 9099 }` to `emulators`. The CLI is invoked with `--config firebase/firebase.json` from the root (or `cd firebase`). `.firebaserc` moves with it.

### 4.4 Tests

| Suite | Location | Runs against |
|---|---|---|
| Frontend unit (vitest) | `apps/web/tests/unit/**` (keep `format-and-redirect`, `pricing` → `price-lines`, add `http.test.ts` (bearer/401 retry), `session.test.ts`, `synthetic-email.test.ts`, `nav.test.ts`) | Node, mocks |
| Backend (pytest) | `backend/tests/**` (unit on fakes + integration on emulators; ports today's `tests/unit/server/**` scenarios incl. `concurrency.test.ts`) | `firebase emulators:exec --only auth,firestore,storage "pytest"` |
| E2E (Playwright) | `apps/web/tests/e2e/**`, config `apps/web/playwright.config.ts` | Next **production build** + uvicorn + emulators |

`apps/web/playwright.config.ts` changes:
- `webServer` becomes an **array**:
  1. `{ command: "<venv-python> -m uvicorn app.main:app --port 8100", cwd: "../../backend", url: "http://127.0.0.1:8100/api/health", env: { APP_ENV: "test", PAYMENT_PROVIDER: "fake", FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, STORAGE_EMULATOR_HOST, CORS_ALLOWED_ORIGINS: "http://localhost:3100", … } }`
  2. `{ command: "npx next start -p 3100", url: "http://localhost:3100" }`
- The **e2e build must be built with e2e `NEXT_PUBLIC_*` values**: `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8100`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-taki`, `NEXT_PUBLIC_ENABLE_DEV_GATEWAY=true`, and no Maps key (fallback inputs). `npm run test:e2e:build` sets these via `.env.test`, loaded with `dotenv-cli` or a small node wrapper.
- `globalSetup`:
  - reset the emulators: Firestore `DELETE /emulator/v1/projects/demo-taki/databases/(default)/documents`, Auth `DELETE http://127.0.0.1:9099/emulator/v1/projects/demo-taki/accounts`, Storage (clear bucket via REST)
  - run `python backend/scripts/seed_emulator.py` **only for specs tagged `@seeded`**. The T2 workflow spec starts from an empty database.
- `tests/support/otp.ts`: `latestSmsCode(phone)` reads `GET http://127.0.0.1:9099/emulator/v1/projects/demo-taki/verificationCodes`, which replaces the fixed `123456`.
- `apiLogin` changes from cookie POST to the Firebase Auth emulator REST `accounts:signInWithPassword` → `idToken` → `extraHTTPHeaders: { authorization }` for API-level setup, plus a UI login helper for page specs.
- `scripts/e2e.mjs`: `firebase emulators:exec --config firebase/firebase.json --only auth,firestore,storage --project demo-taki "npx --prefix apps/web playwright test …"`.

### 4.5 Python tooling (align details with P2)

- Python **3.12** (Docker and CI). Locally `py -3.12 -m venv backend/.venv`, because the machine default is 3.14. `uv` is acceptable.
- `pyproject.toml` holds project metadata and tool config only:
  - `[tool.ruff]` with `target-version = "py312"`, `line-length = 120`, `select = ["E","F","I","B","UP","S","ASYNC"]`
  - `[tool.pytest.ini_options]` with `asyncio_mode = "auto"` and markers `emulator`, `slow`
  - `[tool.mypy]` (optional, CI non-blocking at first, `strict` on `app/core`)
- `requirements.txt` (pinned runtime, used by Docker): `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `firebase-admin`, `google-cloud-firestore`, `google-cloud-storage`, `httpx`, `python-multipart`, `google-auth`, `filetype`.
- `requirements-dev.txt`: `-r requirements.txt`, `pytest`, `pytest-asyncio`, `ruff`, `mypy`, `respx`, `time-machine`, `pytest-xdist`.
- Pin with `pip-compile`/`uv pip compile` (`requirements.in` → `.txt`).

### 4.6 `scripts/dev.mjs` (cross-platform; Windows-safe)

1. Load `backend/.env.local` (if present).
2. Spawn emulators (`--only auth,firestore,storage`, import/export `.data/emulators`) and wait for TCP 9099/8080/9199.
3. Spawn `backend/.venv/{Scripts|bin}/python -m uvicorn app.main:app --reload --port 8000` with `APP_ENV=local`, emulator hosts, `PAYMENT_PROVIDER` (`fake` by default, or `cashfree` with sandbox keys) and `CORS_ALLOWED_ORIGINS=http://localhost:3000`.
4. Spawn `npm --prefix apps/web run dev` (port 3000).
5. Prefix logs `[emu] [api] [web]`. On Ctrl+C kill the trees (`taskkill /T /F` on Windows). Exit if any child dies.

Flags: `--no-emulators` (point at a staging project with your own credentials), `--seed` (runs `seed_emulator.py` once the API is healthy).

### 4.7 `.gitignore` changes

```
node_modules/
**/.next/
apps/web/out/
apps/web/coverage/
apps/web/playwright-report/
apps/web/test-results/*
!apps/web/test-results/visual/
*.tsbuildinfo
next-env.d.ts
.env*
!.env.example
!apps/web/.env.example
!apps/web/.env.development
!backend/.env.example
backend/.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.mypy_cache/
htmlcov/
.coverage
.data/
firebase/*-debug.log
*-debug.log
.firebase/
```
Remove the root-only `test-results/*` and `/.vercel` entries (Vercel is not used).

---

## 5. Deployment

### 5.1 Frontend: Firebase App Hosting

- Create the backend once with `firebase apphosting:backends:create --project <prod>`. Connect the GitHub repo, set **root directory `apps/web`** and **live branch `main`** (automatic rollouts on push), in a region close to India. Check the App Hosting region list; prefer `asia-south1` if offered, otherwise `asia-southeast1`. Repeat for `<staging>` with live branch `develop` (or manual rollouts).
- Next.js on App Hosting uses Firebase's own integration (listed under "Platforms" in `node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`; it is not a verified adapter). **Do not set `output: "standalone"` or `adapterPath`**; App Hosting's buildpack handles it. Keep `next.config.ts` headers (they are honoured).
- `apps/web/apphosting.yaml`:

```yaml
runConfig:
  minInstances: 0        # 1 if cold starts hurt the landing page
  maxInstances: 10
  concurrency: 80
  cpu: 1
  memoryMiB: 512
env:
  - { variable: NEXT_PUBLIC_APP_ENV,            value: production,                  availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_API_BASE_URL,       value: https://api.<domain>,        availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_FIREBASE_API_KEY,   value: <web api key>,               availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, value: <project>.firebaseapp.com, availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID, value: <project>,                  availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_FIREBASE_APP_ID,    value: <app id>,                    availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_AUTH_PHONE_EMAIL_DOMAIN, value: phone.<domain>,         availability: [BUILD, RUNTIME] }
  - { variable: NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, secret: maps-browser-key,      availability: [BUILD, RUNTIME] }  # public by nature; secret only to keep it out of git
  - { variable: NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID, value: <map id>,                    availability: [BUILD, RUNTIME] }
```

- `apphosting.staging.yaml` overrides the values for the staging backend (App Hosting environment-specific files, selected by the backend's environment name).
- Grant the App Hosting backend access to the `maps-browser-key` secret with `firebase apphosting:secrets:grantaccess`.
- Custom domain: App Hosting → Domains → `www.<domain>` (+ apex redirect).

### 5.2 Backend: Cloud Run (Docker)

`backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
RUN useradd --uid 10001 --no-create-home appuser
USER appuser
ENV PORT=8080 WEB_CONCURRENCY=2
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY} \
    --proxy-headers --forwarded-allow-ips="*" --no-server-header --timeout-graceful-shutdown 20
```

(Gunicorn + `uvicorn-worker` is an equal alternative; P2 picks one. `.dockerignore`: `.venv tests __pycache__ .env*`.)

The Cloud Run service is `taki-api` in region **asia-south1** (same region as Firestore and the bucket):

```
gcloud run deploy taki-api --image asia-south1-docker.pkg.dev/$PROJECT/taki/api:$SHA \
  --region asia-south1 --service-account taki-api@$PROJECT.iam.gserviceaccount.com \
  --allow-unauthenticated --ingress all --port 8080 \
  --min-instances 1 --max-instances 10 --concurrency 40 --cpu 1 --memory 512Mi --cpu-boost --timeout 60 \
  --set-env-vars APP_ENV=production,GOOGLE_CLOUD_PROJECT=$PROJECT,FIREBASE_STORAGE_BUCKET=$BUCKET,CORS_ALLOWED_ORIGINS=https://www.<domain>,https://<backend>.hosted.app,APP_ORIGIN=https://www.<domain>,API_PUBLIC_URL=https://api.<domain>,AUTH_PHONE_EMAIL_DOMAIN=phone.<domain>,PAYMENT_PROVIDER=cashfree,CASHFREE_ENV=production,CASHFREE_API_VERSION=2025-01-01,SWEEP_INVOKER_SA=taki-scheduler@$PROJECT.iam.gserviceaccount.com \
  --set-secrets CASHFREE_APP_ID=cashfree-app-id:latest,CASHFREE_SECRET_KEY=cashfree-secret-key:latest,GOOGLE_MAPS_SERVER_KEY=maps-server-key:latest,PII_HASH_KEY=pii-hash-key:latest,FILE_URL_SIGNING_KEY=file-url-signing-key:latest
```

- **min instances 1**: Cashfree webhooks and the payment return page should not hit cold starts. Staging uses 0.
- The service is public (`--allow-unauthenticated`). Authentication happens in the app (Firebase ID token). `/api/internal/*` requires a Google OIDC token from `taki-scheduler@` (verified in-app with `google.oauth2.id_token.verify_oauth2_token`, audience = service URL).
- The backend **refuses to start** in `production` if any `*_EMULATOR_HOST` is set, if `PAYMENT_PROVIDER` ≠ `cashfree`, or if a required secret is missing (today's `checkStartupEnv` behaviour, ported).
- Custom domain `api.<domain>`: Cloud Run domain mapping is not available in every region. If asia-south1 lacks it, use a global external HTTPS load balancer + serverless NEG (also enables Cloud Armor), or use the `*.run.app` URL. Owner choice, §9.
- **Cloud Scheduler**: `taki-sweep` every 5 min → `POST https://api.<domain>/api/internal/sweep` with an OIDC token for SA `taki-scheduler@` (roles: none on Run needed because the service is public; the app checks the token's email).

**Service accounts and IAM**

| SA | Roles |
|---|---|
| `taki-api@` (Cloud Run runtime) | `roles/datastore.user`; `roles/storage.objectAdmin` **on the bucket only**; `roles/firebaseauth.admin`; `roles/secretmanager.secretAccessor` **on the 5 secrets only**; default logging/trace writer |
| `taki-deployer@` (GitHub Actions via **Workload Identity Federation**, no JSON keys) | `roles/run.developer`; `roles/artifactregistry.writer` (repo `taki`); `roles/iam.serviceAccountUser` on `taki-api@`; `roles/firebaserules.admin`; `roles/datastore.indexAdmin`; `roles/firebasestorage.admin` (storage rules) |
| `taki-scheduler@` | Used only to mint the OIDC token for the sweep |

WIF: create pool `github` and provider `github-oidc` (issuer `https://token.actions.githubusercontent.com`) with an attribute condition `assertion.repository == "<owner>/<repo>" && assertion.ref == "refs/heads/main"`. Bind `roles/iam.workloadIdentityUser` on `taki-deployer@` to that principal set.

### 5.3 Firebase project configuration (Blaze)

- **Firestore** in Native mode, location **asia-south1** (irreversible). **Storage** default bucket in the same region.
- Rules stay **deny-all** for clients (`firebase/firestore.rules`, `firebase/storage.rules`). Only the Admin SDK (FastAPI) reads and writes.
- **Indexes**: D3 regenerates `firebase/firestore.indexes.json` for the Python queries (today's file reflects the TS queries) and deploys it with the rules.
- **Auth**:
  - Enable **Phone** and **Email/Password** (password only, no email-link).
  - Keep **email enumeration protection** on.
  - **SMS region policy: allow only `IN`** (stops SMS-pumping fraud; `auth_set_sms_region_policy`).
  - Set a budget alert on Identity Platform SMS.
  - Optional: upgrade to Identity Platform + **reCAPTCHA Enterprise SMS defense** for toll-fraud scoring.
- **Authorised domains** (Auth → Settings): `localhost`, `www.<domain>`, `<domain>`, the App Hosting `*.hosted.app` backend domains (prod + staging) and the staging custom domain. Phone auth reCAPTCHA fails on any domain not listed.
- **Test phone numbers for QA** (Auth → Sign-in method → Phone → "Phone numbers for testing"), configured in **staging** (and production only if the owner agrees):
  - e.g. `+91 90000 10001` code `246810` (customer), `+91 90000 10002` (agency), `+91 90000 10003` (driver)
  - These never send SMS. They still need reCAPTCHA on the web unless the app sets `appVerificationDisabledForTesting`, which it only does with the emulator.
  - **Never give a test number the admin role.** Document them in `docs/DEMO_LOGINS.md` (staging section). Rotate codes if they leak.
- **First admin**: `python backend/scripts/create_admin.py --project <id> --phone +91… --name "TAKI Ops"` (ADC as an owner). It creates the Firebase user + password + `role=admin` claim + `users/{uid}`. There is no UI path to admin.
- **Rules/indexes deploy**: `npm run rules:deploy -- --project <id>` locally, or the `deploy-firebase.yml` workflow.

### 5.4 Cashfree

- Keys: sandbox keys in staging, production keys in prod (Secret Manager `cashfree-app-id`, `cashfree-secret-key`).
- **Webhook**: Cashfree dashboard → Developers → Webhooks → add `https://api.<domain>/api/payments/cashfree/webhook` (sandbox: the staging API URL). Events: `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK`, `REFUND_STATUS_WEBHOOK`. API version `2025-01-01`. The backend also sends `notify_url` per order.
- **Domain whitelisting** (required for production checkout): whitelist `www.<domain>` (and the hosted.app domain if used) in Cashfree → Developers → Whitelisting.
- Merchant activation needs the legal pages (M5) and a working contact page.
- `return_url` must be `https` in production.

### 5.5 Google Maps Platform keys

| Key | Application restriction | API restriction | Where |
|---|---|---|---|
| **Browser** `maps-browser-key` | HTTP referrers: `https://www.<domain>/*`, `https://<domain>/*`, `https://*.hosted.app/*` (narrow to the exact backend hosts), staging domain. **A separate dev key** for `http://localhost:3000/*` | **Maps JavaScript API, Places API (New)** only | App Hosting env (BUILD + RUNTIME), `apps/web/.env.local` |
| **Server** `maps-server-key` | None by default (Cloud Run egress IPs are dynamic). Optional hardening: Direct VPC egress + Cloud NAT with a static IP, then an IP restriction | **Geocoding API, Routes API** only (+ Places API (New) Place Details only if P2 needs it) | Secret Manager → Cloud Run env. **Never** in the frontend or the repo |

Set per-API daily quotas and a billing budget alert. Autocomplete uses session tokens (billing per session). The server caches geocodes by `placeId` (Firestore `geocache`, 30-day TTL, within Google's terms).

### 5.6 GitHub Actions

`ci.yml` (on PR and push):

| Job | Steps |
|---|---|
| `web` | `actions/setup-node@v4` (22.x), `working-directory: apps/web`: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` (vitest) → `npm run build` with placeholder `NEXT_PUBLIC_*` env (no Maps key; fallback paths) |
| `backend` | `actions/setup-python@v5` (3.12) + `actions/setup-java@v4` (temurin 21) + `setup-node` (firebase-tools from root `npm ci`). `pip install -r backend/requirements-dev.txt` → `ruff check` → `ruff format --check` → `mypy` (continue-on-error initially) → `npx firebase emulators:exec --config firebase/firebase.json --only auth,firestore,storage --project demo-taki "pytest -q backend/tests"` |
| `contract` | Start uvicorn → fetch `/openapi.json` → `openapi-typescript` → `tsc -p apps/web/tsconfig.contract.json` (DTO drift check) |
| `docker` | `docker build backend` (no push) |
| `e2e` (on PR to `main` + nightly) | Java + Python + Node → `npm run setup` → e2e build → `npm run e2e -- --project=desktop --project=mobile` → upload the Playwright report |

`deploy-backend.yml` (push to `main` touching `backend/**`, or `workflow_dispatch`; `permissions: { id-token: write, contents: read }`; GitHub environments `staging` (auto) → `production` (required reviewer)):
1. `google-github-actions/auth@v2` (`workload_identity_provider`, `service_account: taki-deployer@`)
2. `google-github-actions/setup-gcloud@v2`
3. `gcloud auth configure-docker asia-south1-docker.pkg.dev`
4. `docker build -t asia-south1-docker.pkg.dev/$PROJECT/taki/api:$GITHUB_SHA backend && docker push …`
5. `google-github-actions/deploy-cloudrun@v2` (service `taki-api`, image, region, flags from §5.2; env and secrets from the environment's vars)
6. Smoke test: `curl -fsS https://api.<domain>/api/health` and check `{"status":"ok","version":"$GITHUB_SHA"}`

`deploy-firebase.yml` (push to `main` touching `firebase/**`): WIF auth → `npx firebase deploy --config firebase/firebase.json --only firestore:rules,firestore:indexes,storage --project $PROJECT --non-interactive` (firebase-tools uses ADC from the auth action).

The frontend has **no workflow**: App Hosting auto-rolls out `main`. A manual rollout is `firebase apphosting:rollouts:create <backend> --git-branch main`.

### 5.7 Environment variables

**Frontend (`apps/web`; all public; set in `.env.development` (committed, emulator defaults), `.env.local` (dev keys), `.env.test` (e2e build), `apphosting.yaml`)**

| Var | Purpose | Local | Prod (App Hosting) |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `local\|test\|staging\|production`; gates dev-only UI | `.env.development` | yaml |
| `NEXT_PUBLIC_API_BASE_URL` | FastAPI origin | `http://127.0.0.1:8000` | yaml |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Web SDK | `demo-key` (emulator) | yaml |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Web SDK | `demo-taki.firebaseapp.com` | yaml |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Web SDK | `demo-taki` | yaml |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Web SDK | `1:0:web:0` | yaml |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | Connect to the Auth emulator + reCAPTCHA bypass | `127.0.0.1:9099` | **unset** |
| `NEXT_PUBLIC_AUTH_PHONE_EMAIL_DOMAIN` | Synthetic email domain (must equal the backend's) | `phone.taki.local` | yaml |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Maps JS + Places | dev key in `.env.local` (optional) | secret |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Advanced markers / cloud styling | optional | yaml |
| `NEXT_PUBLIC_ENABLE_DEV_GATEWAY` | Shows `/customer/payment/dev-gateway` | `true` (local/e2e) | **unset** |

**Backend (`backend/.env.local` for dev; Cloud Run env vars / Secret Manager in prod)**

| Var | Purpose | Prod source |
|---|---|---|
| `APP_ENV` | `local\|test\|staging\|production` | env |
| `GOOGLE_CLOUD_PROJECT` | Project for the Admin SDK (ADC on Cloud Run) | env |
| `FIREBASE_STORAGE_BUCKET` | Private file bucket | env |
| `CORS_ALLOWED_ORIGINS` | Comma list of web origins (exact; no wildcards) | env |
| `APP_ORIGIN` | Web origin for Cashfree `return_url` and links in notifications | env |
| `API_PUBLIC_URL` | Absolute base for signed file URLs and `notify_url` | env |
| `AUTH_PHONE_EMAIL_DOMAIN` | Synthetic email domain | env |
| `FILE_URL_SIGNING_KEY` | HMAC for signed file URLs (≥32 bytes) | **secret** |
| `PII_HASH_KEY` | HMAC of identity-document numbers. **Never rotate.** | **secret** |
| `PAYMENT_PROVIDER` | `cashfree` (prod) \| `fake` (local/test only, refused in prod) | env |
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | Cashfree PG credentials; the secret also verifies webhook signatures | **secret** |
| `CASHFREE_ENV` | `sandbox\|production` | env |
| `CASHFREE_API_VERSION` | `2025-01-01` | env |
| `GOOGLE_MAPS_SERVER_KEY` | Geocoding + Routes | **secret** |
| `SWEEP_INVOKER_SA` | SA email allowed to call `/api/internal/sweep` | env |
| `REQUIRE_DELIVERY_PROOF` | `true` | env |
| `DEV_AUTO_VERIFY_AGENCIES` | Non-prod convenience; refused in prod | env (staging only) |
| `LOG_LEVEL` | `INFO` | env |
| `PORT`, `WEB_CONCURRENCY` | Set by Cloud Run / Dockerfile | runtime |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` (`http://127.0.0.1:9199` for google-cloud-storage) | Emulators. **Startup fails in production if any is set.** | never |
| `MSG91_*` / `SMS_NOTIFICATIONS` | Only if the owner wants transactional SMS (§9) | secret |

**Removed** (TS backend): `SESSION_SECRET`, `CRON_SECRET` (replaced by OIDC), `SMS_PROVIDER`, `DEV_FIXED_OTPS`, `TRUST_PROXY_HEADERS`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `TAKI_E2E`, `SEED_*`, `NEXT_PUBLIC_APP_MODE`.

**GitHub (repo/environment)**: vars `GCP_PROJECT_ID`, `GCP_REGION=asia-south1`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `API_DOMAIN`, `WEB_ORIGINS`. There are **no** long-lived secrets; runtime secrets live only in Secret Manager.

---

## 6. Test plan

Environments:
- **local/CI** = emulators + `PAYMENT_PROVIDER=fake`
- **staging** = a real Firebase project, Cashfree **sandbox**, real Maps keys, Firebase test phone numbers

Every T-agent files bugs with severity, role, route, steps, expected/actual and a screenshot or trace.

### 6.1 T1: responsive UI, navigation, visual

- **Viewports**: the 5 Playwright projects (1440, 1280, 768 touch, 390 mobile, 360 small) for every route in §2. There must be no horizontal scroll at 360 (`document.scrollingElement.scrollWidth <= innerWidth`).
- **Crawler** (`integration.spec.ts`, kept): every route per role and every same-origin link returns no 404 or console error; the branded not-found page shows.
- **Navigation**:
  - `AppHeader` pills and the "More" menu (agency), the mobile drawer, and the driver bottom bar (hidden on action screens)
  - Active-state rules in `isNavItemActive`: "My Shipments" is not active on `/shipments/new`; `/customer/payment` ≠ `/customer/payments`
  - `adminNav` "Payments" (new); footer legal links
- **Guards** (client UX):
  - signed out → role login with `?next=` preserved, including the query string
  - wrong role → own dashboard + toast
  - signed in on `/auth/login` → dashboard unless `?switch=1`
  - `incomplete` user can reach `/auth/create-password` but not dashboards
  - open-redirect `?next=//evil.com` is ignored
- **Auth UI**:
  - reCAPTCHA anchor present and invisible
  - OTP boxes paste, autofill (`autocomplete="one-time-code"`) and resend cooldown
  - error copy for each Firebase code
  - Dev OTP banner **absent**
- **Maps UI**:
  - with a key (staging): autocomplete listbox keyboard navigation (↑↓, Enter, Esc), focus ring, screen-reader announcement; map renders with emerald route and markers; caption says not live
  - **without a key** (CI): the fallback `Input` + district `Select` and the SVG `RouteMap` render with no errors
- **Pricing UI**: the additional-charges repeater (add/remove, max 5, validation) and the line-item breakdown on vehicle details, payment, receipt and agency booking (lines sum to the total).
- **Visual baselines** (`visual.spec.ts` → `apps/web/test-results/visual/*`): regenerate once after the move and compare. **No design drift** from the cream/emerald/lime tokens; only the auth OTP steps, maps and pricing differ intentionally.
- **Accessibility**: `@axe-core/playwright` on every page, with 0 serious or critical issues. Touch targets ≥44 px. Images are labelled. Delivery-proof camera input is labelled.
- **States**: loading skeleton, empty, error + Retry (kill the API mid-test with `page.route` abort) and offline copy on one page per feature.

### 6.2 T2: API, database, full three-role workflow

Start from an **empty** emulator (and once on staging with an empty database).

1. **Bootstrap**: `create_admin.py` → admin logs in at `/admin/login`.
2. **Agency onboarding (UI)**: signup with the Firebase OTP (code read from the emulator) → documents → admin verifies → agency badge shows Verified. Before verification, publishing a trip returns `agency_not_verified`.
3. **Fleet**: vehicle with photo; driver invite → driver signup via the "invited" path → documents → agency approves → admin verifies. Self-registration path: the driver picks an agency → pending → approve.
4. **Trip**: 4 checkpoints (A → B → C → D) with timings, capacity 500 kg, goods restricted (no perishables), per-km, per-kg and **two additional charges** (`always` ₹50, `special_handling` ₹100) → preview distances > 0 (fake Routes in CI, real in staging) → publish → appears in Upcoming.
5. **Customer**:
   - signup (DOB exactly 18 years ago today accepted; 1 day short refused, both client **and** API)
   - shipment B → D 100 kg
   - search shows the trip (**intermediate** match); A → D (**exact**) shows it; D → B (reverse order) does not; wrong date, perishables, 600 kg and a same-district shipment are each excluded with the right reason
6. **Price**: `GET /customer/trips/{id}` lines = segment km × rate + kg × rate + ₹50 (+ ₹100 only with special handling) + service fee; total = sum; the server ignores any client-sent price.
7. **Booking**: request (idempotency: same key twice → one booking, 200 on replay) → agency sees it pending → **reject path** on a second shipment (reason shown to the customer, no hold) → **accept** → hold visible in trip capacity → customer sees driver + vehicle.
8. **Payment (fake provider locally / Cashfree sandbox in staging)**:
   - success → `confirmed`, OTPs shown
   - **failed** → `payment_failed` → retry → success
   - **user dropped** (close the checkout) → still payable
   - **expiry**: advance the clock (backend test clock in `APP_ENV=test`) → sweep → `cancelled`, hold released
9. **Driver**:
   - sees the booking only from `confirmed`
   - start trip (depart checkpoint A) → arrive/depart B → pickup with the wrong code (attempts decrement) then the right code
   - arrive/depart C → out for delivery → deliver **without a photo is refused**; with 2 photos + code → `delivered`
   - every event appears on the customer timeline with the server timestamps, in order
10. **Review**: one review per booking (second → 409); driver and agency aggregates update; agency Reviews card (new) shows it.
11. **Cancellation**: customer cancels a confirmed booking before pickup → refund job → `refund_pending` → (sandbox webhook) `refunded`; capacity released; cancelling after pickup → 409.
12. **Trip cancel**: agency cancels a trip with one awaiting and one confirmed booking → `rejected` and `cancelled` + refund; driver list cleared.
13. **Consistency**: after each step, the booking status and tab are identical in the customer, agency and driver views and in Firestore. Earnings and settlements reflect only paid, delivered bookings.
14. **Database checks** (via emulator REST or pytest): no orphan holds; `trip.bookedKg = Σ holding bookings`; tracking events are append-only; PII document numbers are hashed with only the last 4 digits stored; no `password` field anywhere in Firestore.

### 6.3 T3: security, payments, concurrency, deployment validation

**AuthN/AuthZ**
- Every `/api/*` endpoint without a token → 401; with an expired, forged (wrong project/aud) or revoked token → 401. For each role's endpoint called with the other three roles' tokens → 403 (matrix test generated from the OpenAPI spec).
- **IDOR**: customer A reads or cancels customer B's booking; agency A accepts agency B's booking or edits B's trip; driver A acts on a booking of a trip assigned to driver B; driver acts before `confirmed`. All → 403/404.
- Claim tampering: a client cannot set the `role` claim. Signup as `agency` with a token whose profile is `customer` → 409.
- Public login page with an admin account → refused. An admin role is never obtainable through signup.
- Password reset with a **stale** phone token (`auth_time` > 10 min) → 401. Reset revokes other sessions (an old refresh token fails).

**Document privacy**
- Identity documents: only the owner, the owning agency (driver documents, if P2 allows) and admins get signed URLs. A customer never receives them in any DTO (scan all JSON for `/api/files/`).
- Signed URL tampering (another `fileId`, `exp` extended, `uid` swapped) → 403. An expired URL → 403.
- Storage and Firestore rules deny direct client access (emulator rules test + a direct REST call with the web API key → 403).
- Uploads: wrong magic bytes (`.exe` renamed `.jpg`), >5/8 MB, more than 3 proof files, SVG with script → rejected.
- Receiver and customer phone are not visible to the driver before `confirmed`; driver phone is not visible to the customer before acceptance.

**Payments**
- **Unsigned webhook** (no `x-webhook-signature`), bad signature, signature over a modified body, and a timestamp older than 5 min → 401/400 with no state change.
- **Webhook replay**: the same valid event delivered 3× (and concurrently) → one transition, one notification, 200 each time.
- **Out-of-order**: FAILED after SUCCESS is ignored. SUCCESS after the payment window expired → auto-refund job.
- **Amount tampering**: the client cannot influence `order_amount`. A webhook whose amount ≠ the stored amount → flagged, not confirmed.
- The return page alone never confirms: block the webhook and confirm that only the server-side Get Order makes it `confirmed`.
- Order idempotency: double-click Pay → one Cashfree order (`reused: true`).
- `PAYMENT_PROVIDER=fake` in production → the service refuses to start. `/customer/payment/dev-gateway` → 404 in the prod build.

**Concurrency**
- **Two customers, last capacity**: trip with 100 kg left; customers X and Y each request 100 kg; the agency accepts both **concurrently** (two tabs / 20 parallel API calls) → exactly one `pending_payment`; the other → 409 `insufficient_capacity`, still `awaiting_agency` (or auto-rejected per P2); `bookedKg` never > capacity. Repeat 50 iterations with random interleavings on the emulator.
- If P2 holds capacity at request time: two simultaneous `POST /customer/bookings` for the last kg → one succeeds.
- Hold expiry racing payment success: sweep and webhook at the same instant → either paid and confirmed, or cancelled + auto-refund; never both, never a lost hold.
- Driver double-tap on pickup/deliver → one event. Agency accept vs customer cancel race → a consistent final state.

**Abuse and limits**
- OTP: rely on Firebase quotas + the SMS region policy (a non-IN number → `auth/operation-not-allowed`).
- API rate limits (P2) on login-adjacent and contact endpoints → 429 with `Retry-After`.

**Headers and CORS**
- CORS preflight from a non-allowed origin → no `Access-Control-Allow-Origin`. Allowed origin → credentials not required.
- Security headers present on web pages (`next.config.ts`).
- API: `X-Content-Type-Options`, no server banner, JSON errors without stack traces.

**Deployment validation (staging, then prod)**
- `/api/health` returns the commit SHA.
- Cloud Run runs as `taki-api@`; no default compute SA; secrets mounted from Secret Manager; `min-instances` 1; no emulator vars.
- App Hosting build shows the right `NEXT_PUBLIC_API_BASE_URL` (check the bundle).
- Authorised domains include the live domain (phone OTP works on the real domain with a test number).
- Maps keys: the browser key fails from a non-listed referrer, the server key is not present in any JS bundle (`grep` the build output), and the browser key cannot call Geocoding.
- Cashfree sandbox end to end on staging, including a webhook received (dashboard shows 200).
- Scheduler sweep runs (logs) and is rejected without OIDC.
- Rules deployed equal the repo (`firebase firestore:rules:get` or a console diff); indexes are built.
- Rollback: redeploy the previous Cloud Run revision and roll back App Hosting.

---

## 7. Development work breakdown

### 7.1 Ordering

| Phase | Who | What | Gate |
|---|---|---|---|
| **0. Move (once, first, one owner)** | **D1** only touches the repo root | 1) The orchestrator commits or discards the 28 modified visual PNGs. 2) `git mv` web files into `apps/web/` (`src public tests next.config.ts tsconfig.json eslint.config.mjs vitest*.mts playwright.config.ts package.json package-lock.json next-env.d.ts .env.example .env.development test-results/visual scripts/{e2e,shot}.mjs → apps/web or scripts/`). 3) Fix config paths (`turbopack.root`, playwright `outputDir`, the e2e global-setup path). 4) `npm ci && npm run typecheck && npm test && npm run build` **with the TS backend still in place** (a pure move, no behaviour change). | The orchestrator commits "chore: move web app to apps/web". **Nobody else edits `apps/web` before this commit.** |
| 0' (parallel to 0, disjoint paths) | D5 | `firebase/` (git mv `firebase.json .firebaserc *.rules firestore.indexes.json`, add the Auth emulator), root `package.json` (**after** D1's move commit), `scripts/dev.mjs`, `scripts/setup.mjs`, `.gitignore`, CI skeleton | |
| 0' | D2 | `backend/` skeleton: settings, app factory, `/api/health`, error envelope, Firebase token dependency, CORS, pytest + emulator fixture, Dockerfile | `docker build` + `pytest` green |
| **1. Foundations** | D1 | `lib/firebase/client.ts`, `lib/auth/*`, new `http.ts` (bearer), `session.ts` on `onIdTokenChanged` + `/api/me`; auth views on Firebase OTP; `GuestOnly` handles `incomplete` | Login and signup work against FastAPI auth endpoints (D2) on emulators |
| 1 | D2 | `/api/me`, `/api/auth/signup/{role}`, `/api/auth/password/reset`, `/api/me/{profile,password,phone,photo,documents}`, role claims, `create_admin.py`, signed file URLs, `/api/files/{id}` | |
| 1 | D3 | Firestore repository layer + transactions helper + id/cursor utils (shared by D2/D4/D5), indexes | |
| 1 | D5 | `lib/maps/loader.ts`, `PlaceAutocompleteInput`, `GoogleRouteMap` (with fallbacks); backend `geo` service (Geocoding, Routes, geocache) + `GET /api/geo/{districts,reverse}`; fake Maps for tests | |
| **2. Domain ports** (parallel) | D3 | Agency, vehicles, drivers, invites, trips (preview with Routes, publish rules, **additional charges**), admin verification hooks; **frontend**: `CheckpointEditor` + Places, `SetPricingView` additional charges, `PricePreview`/`TripDetailsView`/`BookingDetailsView` lines, agency Reviews card | `agency-*.spec.ts` green |
| 2 | D4 | Customer shipments (geocode, 18+), matching (exact + intermediate), offers/search, trip details quote, bookings (request/accept/reject/cancel with transactions), tracking, notifications, reviews, driver app actions, sweep; **frontend**: `NewShipmentView` Places + reverse geocode, `BookingSummary`/`ReceiptView` lines, maps in `VehiclesView`/`RouteBookingView`/`TrackingView` | `customer-*`, `booking`, `driver-app` specs green |
| 2 | D5 | Cashfree service (orders, Get Order verify, webhook signature + replay store, refunds outbox), `fake` provider, payment endpoints; frontend `features/payment/**` (Cashfree package loader, dev gateway gated); deploy workflows, WIF, Cloud Run, Scheduler, App Hosting yaml | `payment-tracking.spec` green; staging deploy |
| 2 | D2 | Admin endpoints (queues, verify/reject, settlements, **payments list, booking lookup**), rate limits, audit log; D1 builds `/admin/payments` and `/admin/bookings/[id]` UI | `admin.spec` green |
| **3. Cut-over** | D1 | Delete `src/server`, `src/app/api`, `proxy.ts`, `instrumentation.ts`, TS scripts and tests, server deps; prune `lib/domain` | All e2e + pytest green on emulators; the orchestrator commits |
| **4. Test** | T1/T2/T3 | §6 on local, then staging | Bugs to the owners below |

### 7.2 Ownership in `apps/web` (one owner per path; anyone else asks by message)

| Owner | Paths |
|---|---|
| **D1** (frontend lead, UI, auth) | `apps/web/{package.json,package-lock.json,next.config.ts,tsconfig.json,eslint.config.mjs,vitest.config.mts,playwright.config.ts,apphosting*.yaml,.env.*}` (D5 sends `apphosting.yaml` values; D1 commits them); `src/app/{layout,providers,error,loading,not-found}.tsx`, `src/app/globals.css`, `src/app/(public)/**` incl. **new legal pages**, `src/app/(auth)/**`, `src/app/admin/**`; `src/components/{ui,layout,brand}/**`; `src/lib/{config,firebase,auth,utils,format,schemas}/**`, `src/lib/api/http.ts`, `src/lib/api/{client,contracts}/{auth,admin,notifications,common,errors}.ts`; `src/features/{auth,account,admin,landing,profile,help,legal}/**`; `tests/e2e/{auth,admin,integration,responsive-a11y,visual}.spec.ts`, `tests/support/**`, `tests/unit/**` (frontend); the Phase-0 move and Phase-3 deletions |
| **D3** (agency) | `src/app/agency/**`; `src/features/{agency,driver-dashboard,driver-routes,driver-requests,pricing,earnings}/**`; `src/lib/api/{client,contracts}/agency.ts`; `tests/e2e/{agency-*.spec.ts,agency-flow.ts}`; backend agency/vehicles/drivers/trips modules + Firestore data layer + `firebase/firestore.indexes.json` |
| **D4** (customer + driver app) | `src/app/customer/**` **except** `payment/**`, `booking-confirmation/**`, `payments/**`; `src/app/driver/**`; `src/features/{customer-search,customer-shipment,booking (except RouteMap.tsx, route-map-layout.ts),shipments,tracking,driver-app}/**`; `src/lib/api/{client,contracts}/{customer,driver}.ts`; `tests/e2e/{customer-journey,customer-search,booking,driver-app}.spec.ts`, `booking-flow.ts`; backend shipments/matching/bookings/tracking/notifications/reviews/driver/sweep |
| **D5** (payments, maps, infra) | `src/app/customer/{payment,booking-confirmation,payments}/**`; `src/features/{payment,payments}/**`; `src/features/booking/{RouteMap.tsx,route-map-layout.ts}`; **new** `src/lib/maps/**`, `src/components/maps/**`; `src/lib/api/{client,contracts}/payments.ts`; `tests/e2e/payment-tracking.spec.ts`; root `package.json`, `scripts/**`, `firebase/**`, `.github/**`, `.gitignore`, `backend/{Dockerfile,.dockerignore}`; backend payments + geo services |
| **D2** (FastAPI core) | No `apps/web` files. `backend/app/{main,core(settings,auth,errors,security,rate-limit),api/{me,auth,admin,files,health}}`, `backend/scripts/{create_admin,seed_emulator}.py`, `backend/{pyproject.toml,requirements*.txt}`; publishes `/openapi.json`, which every frontend owner codes against |

Cross-cutting rules:
- Shared UI primitives (`components/ui`) change only through D1. A new primitive is requested, not forked.
- D5's map and autocomplete components expose stable props first (a stub with the fallback UI on day 1), so D3 and D4 can integrate in parallel.
- Every backend endpoint keeps the path and JSON shape of today's TS contract unless P2 says otherwise. A changed shape is sent to the frontend owner of that contract file before merging.
- No dev agent commits, runs `next build`, or runs Playwright in the shared tree (as in v2). The orchestrator runs builds and e2e at phase gates.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Firebase phone + password is not native, and the synthetic email is coupled to the phone | Backend owns email/password updates. Phone change updates both atomically. A unit test covers `syntheticEmail()` parity (TS ↔ Python). |
| reCAPTCHA or authorised-domain misconfiguration blocks all signups on a new domain | Deployment checklist §5.3; T3 smoke test on every new domain. |
| SMS cost/fraud on Blaze | IN-only region policy, budget alert, optional reCAPTCHA Enterprise SMS defense. |
| `NEXT_PUBLIC_*` frozen at build | `availability: [BUILD, RUNTIME]`; a separate e2e build; staging and prod are separate App Hosting backends. |
| Maps unavailable or quota exceeded | Fallback inputs and SVG map; the server caches geocodes. |
| Big-bang auth switch | Phase 1 gate: auth fully on FastAPI before domain ports; the TS backend is deleted only after full e2e parity. |

---

## 9. Open questions for the owner

1. **Production domain(s)**: the web domain (`www.?`), the API domain (`api.?`; a load balancer is needed if Cloud Run domain mapping is unavailable in asia-south1), and the synthetic email domain (`phone.<domain>`).
2. **Regions**: Firestore, Storage and Cloud Run in **asia-south1 (Mumbai)**, which is irreversible for Firestore. Which App Hosting region is acceptable?
3. **Firebase test phone numbers in production**: allowed (QA convenience, small backdoor) or staging only?
4. **Transactional SMS**: Firebase Auth sends only OTPs. Should booking updates and the receiver's delivery code go by SMS (MSG91/other, DLT registration in India), or in-app only?
5. **Capacity hold timing**: keep "hold at agency acceptance" (two customers can both request the last slot; the second accept fails), or hold at request?
6. **Refund policy** for customer cancel after payment, agency trip cancel, and refused pickup: full refund, or minus the TAKI service fee? This is needed for the Refund & Cancellation page and the Cashfree refund amounts.
7. **Legal page content** (Terms, Privacy, Refund, Shipping): will the owner supply the text, or should we draft placeholders for legal review? This is required before Cashfree production activation.
8. **Dev gateway**: OK to keep `/customer/payment/dev-gateway` for local/e2e only (404 in staging and prod)?
9. **Legacy `/driver/routes…` → `/agency/…` redirects**: remove now (recommended; no production users)?
10. **Admin hardening**: is phone + password enough for `/admin`, or add TOTP MFA (Identity Platform) and an IP allowlist?
11. **Staging**: a separate Firebase project (`taki-staging`, Cashfree sandbox) is assumed. Confirm, and confirm who owns the billing budgets and alerts.
12. **Geographic scope**: still the 5 states (TN, KL, KA, TS, AP) for Places restriction and the place validation in matching?
