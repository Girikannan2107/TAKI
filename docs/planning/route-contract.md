# Route Contract — TAKI Travel website (P2)

Every route, its file, title, layout, guard, rendering, state I/O and button destinations.
Conventions: all `page.tsx` files are **server components** exporting `metadata` and rendering a `"use client"` view from `src/features/**` inside `<Suspense fallback={<…Skeleton/>}>` (see technical-architecture.md section 3). "Render" below describes the view. Titles use the root template `"%s | TAKI Travel"`.
Path builders live in `src/lib/config/routes.ts` (e.g. `routes.customer.booking(offer.routeId)`); never hard-code strings in components.
Store = `useTakiStore` (key `taki-demo-v1`). "Hydration" = view shows skeleton until `useHydrated()`.

## 1. Route table

| # | Path | File (`src/app/…`) | Title | Layout | Guard | View render | Ref screen |
|---|---|---|---|---|---|---|---|
| 1 | `/` | `(public)/page.tsx` | TAKI Travel — Smart Logistics Marketplace (absolute) | Public (SiteHeader) | none | Server-rendered sections; header CTAs are client islands | 01 |
| 2 | `/signup` | `(auth)/signup/page.tsx` | Join TAKI Travel | AuthLayout | GuestOnly | client (reads `?role`) | 02 |
| 3 | `/auth/login` | `(auth)/auth/login/page.tsx` | Log in | AuthLayout | GuestOnly | client form | (new, style of 03/05) |
| 4 | `/auth/phone` | `(auth)/auth/phone/page.tsx` | Enter your mobile number | AuthLayout | GuestOnly | client form | 03 |
| 5 | `/auth/verify-otp` | `(auth)/auth/verify-otp/page.tsx` | Verify OTP | AuthLayout | GuestOnly + requires `pendingAuth` | client | 04 |
| 6 | `/auth/create-password` | `(auth)/auth/create-password/page.tsx` | Create a Password | AuthLayout | GuestOnly + requires verified `pendingAuth` | client form | 05 |
| 7 | `/customer` | `customer/page.tsx` | — | — | — | server `redirect("/customer/dashboard")` | — |
| 8 | `/customer/dashboard` | `customer/dashboard/page.tsx` | Home | Customer shell | RequireRole customer | client, hydration | 06 |
| 9 | `/customer/vehicles` | `customer/vehicles/page.tsx` | Available Vehicles | Customer shell | RequireRole customer | client, reads search params | 07 |
| 10 | `/customer/booking/[vehicleId]` | `customer/booking/[vehicleId]/page.tsx` | Route & Booking Details | Customer shell | RequireRole customer | client, `use(params)` | 08 |
| 11 | `/customer/payment` | `customer/payment/page.tsx` | Payment | Customer shell | RequireRole customer | client, `?bookingId` | 09 |
| 12 | `/customer/booking-confirmation` | `customer/booking-confirmation/page.tsx` | Booking Confirmed | Customer shell | RequireRole customer | client, `?bookingId` | (new) |
| 13 | `/customer/tracking/[bookingId]` | `customer/tracking/[bookingId]/page.tsx` | Track Shipment | Customer shell | RequireRole customer | client, `use(params)` | 10 |
| 14 | `/customer/shipments` | `customer/shipments/page.tsx` | My Shipments | Customer shell | RequireRole customer | client | (new) |
| 15 | `/customer/payments` | `customer/payments/page.tsx` | Payments | Customer shell | RequireRole customer | client | (new) |
| 16 | `/customer/profile` | `customer/profile/page.tsx` | Profile | Customer shell | RequireRole customer | client form | (new) |
| 17 | `/driver` | `driver/page.tsx` | — | — | — | server `redirect("/driver/dashboard")` | — |
| 18 | `/driver/dashboard` | `driver/dashboard/page.tsx` | Dashboard | Driver shell | RequireRole driver | client, hydration | 11 |
| 19 | `/driver/routes` | `driver/routes/page.tsx` | My Routes | Driver shell | RequireRole driver | client, `?published` | (new) |
| 20 | `/driver/routes/new` | `driver/routes/new/page.tsx` | Add New Route | Driver shell | RequireRole driver | client form | 12 |
| 21 | `/driver/routes/new/pricing` | `driver/routes/new/pricing/page.tsx` | Set Pricing | Driver shell | RequireRole driver + requires `routeDraft` | client form | 13 |
| 22 | `/driver/bookings` | `driver/bookings/page.tsx` | Booking Requests | Driver shell | RequireRole driver | client, `?tab` | 14 |
| 23 | `/driver/earnings` | `driver/earnings/page.tsx` | Earnings | Driver shell | RequireRole driver | client | 15 |
| 24 | `/driver/profile` | `driver/profile/page.tsx` | Profile | Driver shell | RequireRole driver | client form | (new) |
| 25 | `/driver/help` | `driver/help/page.tsx` | Help | Driver shell | RequireRole driver | mostly static (FAQ accordion via `<details>`) | (new) |
| 26 | `/api/payments/cashfree/order` | `api/payments/cashfree/order/route.ts` | — | — | server; 501 unless configured | POST | — |
| 27 | `/api/payments/cashfree/verify` | `api/payments/cashfree/verify/route.ts` | — | — | server; 501 unless configured | GET | — |
| 28 | `/api/payments/cashfree/webhook` | `api/payments/cashfree/webhook/route.ts` | — | — | server; signature check; 501 unless configured | POST | — |
| — | 404 | `not-found.tsx` | Page not found | bare + Logo | — | server; links Home `/` | — |
| — | error | `error.tsx` (client) | — | bare | — | "Try again" -> `reset()`; "Go home" -> `/` | — |

Shells: Customer shell = `customer/layout.tsx` -> `<RequireRole role="customer"><DashboardShell role="customer" nav={customerNav}>`. Driver shell likewise with `driverNav`. Booking-flow pages (9-13) and route-creation pages (20-21) show `PageHeader` with a back arrow (as in reference) inside the shell; dashboard pages show the greeting `TopBar` (bell + avatar).

## 2. Query parameters

| Route | Param | Values | Purpose |
|---|---|---|---|
| `/signup` | `role` | `customer` \| `driver` | Pre-highlight a card (from landing CTAs) |
| `/auth/login` | `next` | internal path | Return URL after login; validated by `safeRedirect()` |
| `/auth/login` | `role` | `customer` \| `driver` | Optional hint; only affects demo fill button order |
| `/auth/phone` | `flow` | `signup` (default) \| `login` \| `reset` | Which OTP flow |
| `/auth/phone` | `role` | `customer` \| `driver` | Required when `flow=signup`; missing -> redirect `/signup` |
| `/auth/phone`, `/auth/verify-otp`, `/auth/create-password` | `next` | internal path | Carried through the flow |
| `/customer/vehicles` | `from`, `to` (CityId slugs, e.g. `coimbatore`), `weight` (integer kg), `date` (`YYYY-MM-DD`) | | Search criteria (source of truth; mirrored into `search` slice). Invalid/missing -> EmptyState with "Edit search" -> dashboard |
| `/customer/vehicles` | `sort` | `best` \| `price` \| `capacity` | Optional sort (default `best`) |
| `/customer/payment` | `bookingId` | booking id | Booking to pay; missing/unknown -> EmptyState |
| `/customer/booking-confirmation` | `bookingId` | booking id | |
| `/driver/routes` | `published` | route id | Highlight + success toast after publish |
| `/driver/routes` | `status` | `active` (default) \| `completed` \| `all` | Filter (from dashboard StatCards) |
| `/driver/bookings` | `tab` | `pending` (default) \| `accepted` \| `declined` \| `withdrawn` | Filter tabs |

Phone numbers are never put in URLs (kept in `pendingAuth` slice).

## 3. Guards

- **GuestOnly** (`(auth)/layout.tsx`): after hydration, if `session` exists -> `router.replace(dashboardFor(role))`.
- **pendingAuth guard**: `/auth/verify-otp` without `pendingAuth` -> `/auth/phone` (keep `flow`, `role`, `next`). `/auth/create-password` without `pendingAuth.verified` -> `/auth/phone`.
- **RequireRole**: no session -> `/auth/login?next=<current path+query>`; wrong role -> own dashboard + info toast.
- **Draft guards**: `/customer/booking/[vehicleId]` (value = `VehicleOffer.routeId`, e.g. `rte_r1`) with unknown route / no capacity -> EmptyState "Vehicle no longer available" + button to `/customer/dashboard`. `/driver/routes/new/pricing` without `routeDraft` -> `router.replace("/driver/routes/new")`.
- After login/sign-up: go to `safeRedirect(next, role) ?? dashboardFor(role)`.

## 4. Per-route state I/O and actions

### `/` Landing (D2)
- Reads: `session` (client island only, after hydration) to adapt CTAs. Writes: nothing.
- Header nav: How it Works -> `#how-it-works`; Benefits -> `#benefits`; About -> `#about`; Contact -> `#contact` (smooth scroll, sections exist on page). Logo -> `/`.
- Login -> `/auth/login` (if session: label becomes "Dashboard" -> `dashboardFor(role)`).
- Ship Goods -> `/signup?role=customer` (customer session -> `/customer/dashboard`).
- List a Route -> `/signup?role=driver` (driver session -> `/driver/routes/new`).
- Mobile: hamburger opens `MobileNavDrawer` with the same links + Login.
- Contact section: `mailto:`/`tel:` placeholders only, no form submission backend.

### `/signup` Role selection (D3)
- Reads `?role`, `?next`. Writes nothing.
- "I'm a Customer" card -> `/auth/phone?flow=signup&role=customer` (+`next`).
- "I'm a Lorry Driver" card -> `/auth/phone?flow=signup&role=driver`.
- Footer link "Already have an account? Log in" -> `/auth/login`. Logo -> `/`.
- Cards are `<Link>`s styled as cards (whole card clickable, one tab stop each).

### `/auth/login` (D3)
- Form: mobile (+91 prefix), password. Writes `session` on success.
- "Log in" (submit) -> `safeRedirect(next, role) ?? dashboardFor(role)`; error "Mobile number or password is incorrect".
- "Forgot password?" -> `/auth/phone?flow=reset`.
- "Log in with OTP instead" -> `/auth/phone?flow=login` (+`next`).
- "New to TAKI? Create an account" -> `/signup`.
- DemoBanner buttons "Fill demo customer" / "Fill demo driver" populate the form (do not auto-submit).
- Back arrow -> `/`.

### `/auth/phone` (D3)
- Writes `pendingAuth = { flow, role, phone, requestId, expiresAt }` + transient `demoCode`.
- "Send OTP" -> `authAdapter.sendOtp` -> `/auth/verify-otp?flow=…&role=…&next=…`. For `flow=login|reset` with unknown number -> inline error + link to `/signup`. For `flow=signup` with an existing number -> inline error + link to `/auth/login`.
- Back arrow -> `/signup` (signup) or `/auth/login` (login/reset).

### `/auth/verify-otp` (D3)
- Reads `pendingAuth`, `demoCode`. Shows DemoBanner with code (`data-testid="demo-otp-code"`).
- "Verify" -> `verifyOtp`; success: `flow=signup|reset` -> `/auth/create-password?flow=…&next=…`; `flow=login` -> set `session`, go to `safeRedirect ?? dashboard`. Error states: invalid (attempts left), expired (prompt resend), too many attempts (back to phone).
- "Resend OTP" (enabled after 00:30 countdown) -> `sendOtp` again, new demo code, countdown resets.
- "Change number" / back arrow -> `/auth/phone` (same query).
- Auto-submit when 6th digit entered (also Enter key).

### `/auth/create-password` (D3)
- Fields: (signup only) full name, password, confirm password; live checklist (8+ chars, one uppercase, one number).
- "Create Account" (signup) / "Save Password" (reset) -> `setPassword` -> writes `users`, `session`, clears `pendingAuth` -> `safeRedirect ?? dashboardFor(role)`; toast "Welcome to TAKI, {name}". Reset -> `/auth/login` with success toast.
- Back arrow -> `/auth/verify-otp` (same query).

### `/customer/dashboard` Home (D4)
- Reads `session.name`, `search` (prefill last search), recent `bookings` (optional "Recent shipments" list below the form on wide screens).
- ShipmentForm fields: Source, Destination (city select/combobox from seed cities), Cargo Weight (kg unit select shown as in the reference; value stored as `weightKg`), Pickup Date.
- "Find Available Vehicles" -> writes `search` -> `/customer/vehicles?from=…&to=…&weight=…&date=…`.
- Swap icon between source/destination (optional) swaps values.
- TopBar bell -> opens notifications popover (demo list, "No new notifications" EmptyState). Avatar -> menu: Profile `/customer/profile`, Log out (-> `logout()` -> `/`).
- Recent shipment row -> `/customer/tracking/[bookingId]`.

### `/customer/vehicles` Available Vehicles (D4)
- Reads search params + `vehicleRepository.search()`. Writes `search`, `selectedRouteId`.
- Header "Available Vehicles (n)" + summary chips `Coimbatore -> Chennai | 500 kg | 20 Nov, 2025`. Back arrow -> `/customer/dashboard`.
- "Edit" (on summary) -> `/customer/dashboard` (form prefilled).
- "View & Select" on VehicleCard -> `/customer/booking/<offer.routeId>` (query string preserved).
- Sort select updates `?sort` (router.replace, no scroll).
- Zero results -> EmptyState "No vehicles on this route yet" + "Change search" -> `/customer/dashboard`.

### `/customer/booking/[vehicleId]` Route & Booking Details (D5)
- Reads the offer via `offerRepository.getByRouteId(routeId, search)`, plus `search`. Shows operator header (rating, vehicle model, masked reg no.), RouteMap (illustrative, labelled), distance / duration / stops, route line, BookingSummary preview (price breakdown from `domain/pricing`).
- "Book This Vehicle" -> `bookingService.createDraft()` (snapshots `PricingBreakdown`; status `pending_payment`) -> `/customer/payment?bookingId=…`. Disabled while creating.
- Back arrow -> `/customer/vehicles?…` (previous search).
- If `search` missing (deep link): show inline mini-form for weight + date before enabling Book.

### `/customer/payment` Payment (D6)
- Reads booking by `bookingId`; creates idempotency key on mount. Writes `payments`, booking status.
- PaymentMethodSelector: UPI (default), Credit/Debit Card, Net Banking (radio group). DemoBanner "Demo payment — no money moves".
- "Pay ₹4,850" -> `paymentAdapter.createOrder` -> `confirm` -> `verify`; `paid` -> booking `awaiting_driver` -> `router.replace("/customer/booking-confirmation?bookingId=…")`. `failed` -> booking `payment_failed`, inline error + "Try again" (new attempt key).
- Booking in any status other than `pending_payment`/`payment_failed` -> `router.replace` to confirmation. Unknown id -> EmptyState -> `/customer/dashboard`.
- Back arrow -> `/customer/booking/[vehicleId]`. "Cancel booking" (text button) -> ConfirmDialog -> status `cancelled` -> `/customer/dashboard`.

### `/customer/booking-confirmation` (D6)
- Reads booking. Heading "Booking placed!" with an "Awaiting driver confirmation" Badge (when `awaiting_driver`; "Confirmed" once accepted). Shows Booking ID (copy button), route, date, amount paid and a "Demo payment" label.
- "Track Shipment" (primary) -> `/customer/tracking/[bookingId]`.
- "Book another shipment" -> `/customer/dashboard`. "View my shipments" -> `/customer/shipments`.

### `/customer/tracking/[bookingId]` Track Shipment (D6)
- Reads booking + `statusHistory`. StatusTimeline (Booking Confirmed, Picked Up, In Transit, Out for Delivery, Delivered) with timestamps. While `awaiting_driver`, it shows a first "Awaiting driver confirmation" step. When the booking is `declined`, it shows a "Declined by driver — refund issued (demo)" notice and a "Find another vehicle" button -> `/customer/dashboard`.
- Copy icon next to Booking ID -> clipboard + toast "Booking ID copied".
- "View Route" (reference: "View Live Route"; renamed — not live GPS) -> opens Modal with RouteMap labelled "Illustrative route — not live location".
- Back arrow -> `/customer/shipments`.
- Unknown/other-user booking -> EmptyState "Shipment not found" -> `/customer/shipments`.

### `/customer/shipments` My Shipments (D4)
- Reads `bookings` for current customer. Tabs: Active / Completed / Cancelled.
- Row/card -> `/customer/tracking/[bookingId]`; `pending_payment`/`payment_failed` row "Complete payment" -> `/customer/payment?bookingId=…`.
- EmptyState "No shipments yet" + "Ship goods" -> `/customer/dashboard`.

### `/customer/payments` Payments (D6)
- Reads `payments` + bookings. Table/list: date, booking ID, amount, method, status Badge (Paid/Failed) with "Demo" tag.
- Row booking ID -> `/customer/tracking/[bookingId]`. EmptyState -> `/customer/dashboard`.

### `/customer/profile` Profile (D3)
- Reads/writes `users[session.userId]` (name, email optional). Phone read-only.
- "Save changes" -> toast. "Log out" -> `logout()` -> `/`. "Reset demo data" -> ConfirmDialog -> `resetDemo()` -> `/`.

### `/driver/dashboard` (D7)
- Reads `session.name`, earnings summary, counts (active routes, pending requests, completed trips, available capacity).
- StatCards: Active Routes -> `/driver/routes`; Booking Requests -> `/driver/bookings`; Completed Trips -> `/driver/routes?status=completed` (filter param optional); Available Capacity -> `/driver/routes`.
- Total Earnings card -> `/driver/earnings`.
- "Post a New Route" -> `/driver/routes/new` (clears stale `routeDraft` only if user confirms "Start over?" when one exists; otherwise resumes).
- TopBar bell/avatar as customer (Profile -> `/driver/profile`).

### `/driver/routes` My Routes (D7)
- Reads `routes` for driver; highlights `?published` with toast "Route published". Card shows from -> to, date, vehicle, available capacity, status Badge (Active/Completed).
- "Add New Route" -> `/driver/routes/new`. Card "View requests" -> `/driver/bookings`.
- EmptyState "You haven't listed a route" + "Post a New Route".

### `/driver/routes/new` Add New Route (D7)
- Form: From, To, Intermediate Stops (chips, "+ Add Stop", remove x), Travel Date, Departure Time, Vehicle Type (select), Total Capacity, Available Capacity (<= total).
- "Next: Set Pricing" -> writes `routeDraft` -> `/driver/routes/new/pricing`.
- Back arrow -> `/driver/dashboard` (draft kept; "Discard draft" text button -> ConfirmDialog -> clears).

### `/driver/routes/new/pricing` Set Pricing (D8)
- Reads `routeDraft`. Fields: per-km rate (₹/km), per-kg rate (₹/kg), entered in rupees with up to 2 decimals and stored as paise. Prefilled from `Driver.defaultRatePer{Km,Kg}Paise`. Live Price Preview (example 500 kg) from `domain/pricing`; note "The customer will see a final price with a small TAKI service fee added."
- "Publish Route" -> `routeService.publish(draft)` -> clears `routeDraft` -> `router.replace("/driver/routes?published=<id>")`.
- Back arrow -> `/driver/routes/new` (draft preserved).

### `/driver/bookings` Booking Requests (D8)
- Reads requests derived from `bookings` on the driver's routes (`BookingRequestStatus`), plus `?tab`. Header "Booking Requests (n)" counts pending.
- "Accept" -> `acceptRequest(bookingId)`: booking `awaiting_driver -> confirmed` and the route's capacity is deducted. Toast "Request accepted"; the card moves to the Accepted tab.
- "Decline" -> ConfirmDialog ("Decline this request? The customer will be refunded (demo).") -> `declineRequest(bookingId)` -> booking `declined`, payment `refunded` (demo) -> toast.
- Tabs update `?tab` via `router.replace`. EmptyState "No pending requests" + "Post a New Route" -> `/driver/routes/new`.

### `/driver/earnings` Earnings (D8)
- Reads earnings summary, settlements, payouts. Cards: Available for Payout; This Month / Last Month / Total; Recent Settlements list with Paid badge; MiniAreaChart (monthly).
- "Withdraw" -> Modal: amount (<= available), DemoBanner "Demo payout — no money moves", "Confirm withdrawal" -> `requestWithdrawal` -> toast; disabled when available = 0.
- Settlement row -> no navigation (static) in demo.

### `/driver/profile` (D3) — as customer profile plus vehicle details (type, reg no., capacity). Log out / Reset demo data same as customer.

### `/driver/help` (D7)
- FAQ (`<details>`), contact options (mailto/tel placeholders), "How pricing works" link -> `/driver/routes/new/pricing` only if draft exists, else plain text.

## 5. Sidebar navigation (`src/lib/config/nav.ts`; icons per P1 ui-design-spec)

| Shell | Label | Icon (lucide) | href | Active when path starts with |
|---|---|---|---|---|
| Customer | Home | `House` | `/customer/dashboard` | `/customer/dashboard`, `/customer/vehicles`, `/customer/booking`, `/customer/payment`, `/customer/booking-confirmation` |
| Customer | My Shipments | `Package` | `/customer/shipments` | `/customer/shipments`, `/customer/tracking` |
| Customer | Payments | `Wallet` | `/customer/payments` | `/customer/payments` |
| Customer | Profile | `UserRound` | `/customer/profile` | `/customer/profile` |
| Driver | Dashboard | `House` | `/driver/dashboard` | `/driver/dashboard` |
| Driver | My Routes | `Route` | `/driver/routes` | `/driver/routes` |
| Driver | Booking Requests | `ClipboardList` | `/driver/bookings` | `/driver/bookings` |
| Driver | Earnings | `IndianRupee` | `/driver/earnings` | `/driver/earnings` |
| Driver | Profile | `UserRound` | `/driver/profile` | `/driver/profile` |
| Driver | Help | `CircleHelp` | `/driver/help` | `/driver/help` |

Sidebar footer: "Log out" button (both shells). Active item uses `aria-current="page"`. Note `/customer/payment` (singular, checkout) is under Home; `/customer/payments` (plural, history) is its own item — keep both names exactly.

## 6. Full flow sequences (for e2e)

- **Customer**: `/` -> Ship Goods -> `/signup?role=customer` -> customer card -> `/auth/phone` -> Send OTP -> `/auth/verify-otp` (read demo code) -> Verify -> `/auth/create-password` -> Create Account -> `/customer/dashboard` -> Find Available Vehicles -> `/customer/vehicles?…` -> View & Select -> `/customer/booking/rte_…` -> Book This Vehicle -> `/customer/payment?bookingId=…` -> Pay -> `/customer/booking-confirmation?bookingId=…` ("Awaiting driver confirmation") -> Track Shipment -> `/customer/tracking/…`.
- **Driver**: `/` -> List a Route -> `/signup?role=driver` -> … -> `/driver/dashboard` -> Post a New Route -> `/driver/routes/new` -> Next: Set Pricing -> `/driver/routes/new/pricing` -> Publish Route -> `/driver/routes?published=…`; Sidebar Booking Requests -> Accept (customer tracking then shows Booking Confirmed) / Decline; Earnings -> Withdraw (₹100 to the available balance).
- **Guard**: logged-out visit `/customer/payment?bookingId=x` -> `/auth/login?next=%2Fcustomer%2Fpayment%3FbookingId%3Dx` -> login as customer -> back to that URL.
