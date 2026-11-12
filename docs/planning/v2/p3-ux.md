# P3 — UI/UX plan for TAKI v2 (three-role marketplace)

Author: P3 (UI/UX planner) · 2026-11-13 · branch `feat/marketplace` · planning only, no app code changed.
Inputs: `00-requirements.md`, `Reference.jpeg` + `references/screens/01–15`, current UI (`src/app`, `src/components`, `src/features`, `globals.css`, `nav.ts`, `routes.ts`), `docs/planning/ui-design-spec.md` (v1 spec, still authoritative for type scale, radii, shadows, icons and interaction states).

**Ground rules for every UI dev (D1–D4)**
- Do not redesign. Keep the dark-green sidebar shell (`DashboardShell` / `DashboardSidebar`), the auth card (`AuthLayout` + `WaveDecoration`), white cards, Montserrat/Inter, lucide icons and every existing primitive in `src/components/ui`. New screens are built from those parts.
- Reference screens map 1:1 onto current or moved routes (see §2.5). New screens (agency vehicles/drivers/history, driver app, signup details) have no reference image. Build them from the same parts and patterns.
- The repo pins a Next.js with breaking changes. Read `node_modules/next/dist/docs/` before writing routing, layout or `next/image` code (see `AGENTS.md`).
- Every list, form and action needs all four states. §3.0 has the shared rules.
- The brief says "No fabricated data". Any `Demo…` copy, `DemoBanner kind="general"` and "Reset demo data" goes away once the backend is real. The only demo-only UI left is the **"Dev OTP"** label (owner decision) and the sandbox payment notice.

---

## 1. Design tokens: reconciling with 60:30:10

### 1.1 Current vs brief

| Role in brief | Brief hex | Closest current token | Where the current one is used |
|---|---|---|---|
| 60% light sage (workspace/page bg) | `#E7EDE3` | `--color-canvas #f5f5ef` (cream) | `body`, `DashboardShell` bg, landing alt sections |
| 30% dark sage (structure) | `#244F3F` | `--color-brand-primary #173d32`; sidebar gradient `#022a1c→#05402b→#1a6a40`; mobile top bar `bg-green-950` | Sidebar, mobile top bar, drawer, footer |
| 10% coral (accent) | `#F08065` | none. Lime `#b4e799` is the current accent | Active nav pill, "Ship Goods" hero CTA, Withdraw, dark focus ring |
| White cards | `#FFFFFF` | `--color-surface` ✓ | Cards, inputs |
| Primary action | (not specified) | `green-700 #0d6336` + `bg-grad-primary` | All primary buttons. **Keep.** |

### 1.2 Contrast (WCAG 2.1, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| `#244F3F` text on white / on `#E7EDE3` | 9.27 / 7.78 | AA ✓ (any size) |
| white text on `#244F3F` | 9.27 | AA ✓ |
| `#b4e799` lime pill/focus on `#244F3F` | 6.55 | ✓ |
| ink `#242b29` on `#E7EDE3` | 12.13 | ✓ |
| ink-muted `#5e6661` on `#E7EDE3` | 4.96 | ✓ |
| **ink-subtle `#6b726d` on `#E7EDE3`** | **4.14** | **✗ fails AA.** It also fails on `surface-muted #f1f3ed` (4.42) today |
| green-700 `#0d6336` / price `#145a32` / error `#b42318` on `#E7EDE3` | 6.17 / 6.94 / 5.52 | ✓ |
| **coral `#F08065` text on white / on `#E7EDE3`** | **2.63 / 2.21** | **✗ fails, even for large text (needs 3:1)** |
| **white text on coral** | **2.63** | **✗** |
| `#244F3F` text on coral | 3.52 | Large/bold ≥18.66px only, so avoid |
| green-950 `#022a1c` text on coral | 5.91 | ✓ use this for coral buttons |
| green-950 on coral hover `#F4957E` | 6.99 | ✓ |
| coral-700 `#A8432B` text on white / sage / coral-100 `#FDE7E1` | 6.00 / 5.03 / 5.05 | ✓ use this for coral-family text |
| coral `#F08065` as a non-text mark on `#244F3F` / `#1a3a2e` | 3.52 / 4.73 | ✓ (≥3:1 for UI graphics) |

### 1.3 Where coral may appear (the 10%)

| Allowed | Treatment |
|---|---|
| One "create" CTA per screen: landing hero **Ship Goods**, customer dashboard **New Shipment**, agency dashboard **Add Trip** | New `Button variant="accent"`: bg coral-400, **text green-950**, hover coral-300 |
| "Needs action" badges: Pending approval, Payment due, Verification pending, pending-request counts | New `Badge tone="attention"`: bg coral-100, text coral-700, always with an icon (`CircleAlert`/`Clock`) so the badge never relies on colour alone |
| Notification dot on the bell, current-step dot in `Stepper`, chart highlight point, landing step numerals and eyebrow underline | Decorative. The `aria-label` already carries the meaning |
| **Never** | Body text, links, coral text on light backgrounds, white text on coral, error states (keep red `error`/`danger` so "attention" and "error" stay distinct), large fills (coral must stay ≈10%) |

Lime stays where it is: active sidebar pill, dark-surface focus ring, Withdraw, `::selection`. It is part of the existing TAKI identity and passes on the new sidebar.

### 1.4 Exact edits to `src/app/globals.css` (owner: D1, Wave 0)

```css
/* @theme — changed values */
--color-brand-primary: #244f3f;   /* was #173d32 → 30% dark sage (footer, dark surfaces) */
--color-canvas: #e7ede3;          /* was #f5f5ef → 60% light sage page/workspace */
--color-ink-subtle: #606762;      /* was #6b726d → 4.88:1 on sage, 5.20 on surface-muted, 5.81 on white */
--color-skeleton: #dfe6da;        /* was #eceee8 → stays visible on both white cards and sage canvas */

/* @theme — new tokens */
--color-sage-100: #e7ede3;        /* alias of canvas for explicit "sage" fills (landing alt bands, table stripes on white) */
--color-sage-900: #244f3f;        /* dark sage: mobile top bar, bottom nav */
--color-sage-950: #1a3a2e;        /* darkest sage: sidebar top, drawer */
--color-coral-100: #fde7e1;       /* attention badge bg */
--color-coral-300: #f4957e;       /* accent hover */
--color-coral-400: #f08065;       /* 10% accent fill: CTA, dots */
--color-coral-700: #a8432b;       /* coral-family TEXT only */

/* @utility bg-grad-sidebar — replace value */
background-image: linear-gradient(180deg, #1a3a2e 0%, #244f3f 55%, #2c5c49 100%);
/* was #022a1c → #05402b → #1a6a40. White/85 text ≥6.2:1, lime pill 5.4–8.8:1 across the gradient */
```

Component edits that follow from the tokens (D1):
- `DashboardShell` mobile header: `bg-green-950` → `bg-sage-900`.
- `DashboardSidebar` fallback `bg-green-900` → `bg-sage-900`.
- `MobileNavDrawer` `bg-green-950` → `bg-sage-950`.
- `Button`: add `accent: "bg-coral-400 text-green-950 hover:bg-coral-300 motion-safe:hover:-translate-y-px"`.
- `Badge`: add `attention: "bg-coral-100 text-coral-700"`.
- `IconButton` badge dot → `bg-coral-400`.
- Leave alone: the green scale, `bg-grad-primary`, the earnings gradients and the hero overlay. They are tested, pass AA, and changing them would be a redesign. The overlay is optional: retinting it to `rgb(36 79 63)` is a lead decision, and it is not required for 60:30:10 because the hero is a photo.
- Re-baseline `test-results/visual/*` after Wave 0, because every screen's background changes.

---

## 2. Sitemap

### 2.1 Roles and route groups

`Role` becomes `'customer' | 'agency' | 'driver'` (domain owned by P2). Today's `/driver/*` is an **owner-operator UI**. Its screens become **agency** screens under `/agency/*`. `/driver/*` is reused for the **new mobile-first driver app**. Add redirects in `next.config.ts` for the old operator paths (`/driver/routes*`, `/driver/bookings`, `/driver/earnings`, `/driver/help`), pointing at their `/agency/*` equivalents, for one release.

### 2.2 Public and auth

| Route | Status | Purpose |
|---|---|---|
| `/` | modify (copy) | Landing (§5) |
| `/auth/login?role=customer\|agency\|driver&next=` | modify | One page with a 3-way role `Tabs` header ("Customer / Travel agency / Driver"). Heading, copy and signup link change per role. The server rejects a login whose account role ≠ selected role. Landing/footer deep-link to the role URL. Default role is `customer` |
| `/signup` | modify | Role selection (ref 02): **3** cards (Customer `Package`, Travel Agency `Building2`, Driver `Truck`) |
| `/signup/customer` | new | Step 1/3 details: name, DOB |
| `/signup/agency` | new | Step 1/4 details: owner, agency, district, vehicle range, states |
| `/signup/driver` | new | Step 1/4 details: name, associated agency |
| `/auth/phone?flow=signup\|login\|reset&role=` | reuse | Phone step (ref 03). The `role` param is now 3-valued |
| `/auth/verify-otp?…` | reuse | OTP (ref 04). The demo banner says **"Dev OTP"** |
| `/auth/create-password?flow=signup\|reset&role=` | reuse | Password + confirm (ref 05). On signup it creates the account, then redirects: customer → `/customer/dashboard`; agency → `/agency/profile/verification?onboarding=1`; driver → `/driver/profile/documents?onboarding=1` |
| Password recovery | reuse | `/auth/login` "Forgot password?" → `/auth/phone?flow=reset&role=` → verify → create-password |

Documents and photo are uploaded **after** the account exists, inside the role shell, so uploads are authenticated and server-authorised. Signup stays one continuous flow because the onboarding page carries the step indicator ("Step 4 of 4"). Until verification is approved the user sees a pending banner and gated actions.

### 2.3 Customer: `/customer/*` (shell: sidebar ≥lg, drawer <lg; unchanged pattern)

Nav from the brief: **Dashboard, New Shipment, My Shipments, Profile**

| Nav item | href | icon | matchPrefixes |
|---|---|---|---|
| Dashboard | `/customer/dashboard` | `House` (existing) | `/customer/dashboard` |
| New Shipment | `/customer/shipments/new` | `PackagePlus` | `/customer/shipments/new`, `/customer/vehicles`, `/customer/booking`, `/customer/payment?`, `/customer/booking-confirmation` |
| My Shipments | `/customer/shipments` | `Package` | `/customer/shipments?` (exact, so it doesn't light up on `/new`), `/customer/tracking`, `/customer/receipt`, `/customer/payments` |
| Profile | `/customer/profile` | `UserRound` | `/customer/profile` |

Routes: `/customer/dashboard`, `/customer/shipments/new`, `/customer/vehicles?shipment=…&filters`, `/customer/booking/[tripId]?shipment=` (vehicle details), `/customer/payment?bookingId=`, `/customer/booking-confirmation?bookingId=`, `/customer/shipments?tab=`, `/customer/tracking/[bookingId]` (**canonical shipment details + tracking + feedback**; the path is kept because notifications, tests and list items already link to it), `/customer/receipt/[bookingId]`, `/customer/payments` (payment history, reached from Profile and receipts, removed from the sidebar), `/customer/profile`.

Guest paths stay as they are (`dashboard`, `vehicles`, `booking/`). New Shipment and every step after it need a login.

### 2.4 Agency: `/agency/*` (new shell role, same sidebar)

Nav from the brief: **Dashboard, Vehicles, Drivers, Add Trip, Trips, Bookings, History, Earnings, Profile, Help**

| Nav item | href | icon | matchPrefixes |
|---|---|---|---|
| Dashboard | `/agency/dashboard` | `LayoutDashboard` | `/agency/dashboard` |
| Vehicles | `/agency/vehicles` | `Truck` | `/agency/vehicles` |
| Drivers | `/agency/drivers` | `IdCard` | `/agency/drivers` |
| Add Trip | `/agency/trips/new` | `CirclePlus` | `/agency/trips/new` (also covers `/new/pricing`) |
| Trips | `/agency/trips` | `Route` | `/agency/trips?` (exact), `/agency/trips/[id]` via an `isNavItemActive` exclusion of `/new` |
| Bookings | `/agency/bookings` | `ClipboardList` | `/agency/bookings` |
| History | `/agency/history` | `History` | `/agency/history` |
| Earnings | `/agency/earnings` | `IndianRupee` | `/agency/earnings` |
| Profile | `/agency/profile` | `UserRound` | `/agency/profile` |
| Help | `/agency/help` | `CircleHelp` | `/agency/help` |

Routes:
- `/agency/dashboard`
- `/agency/vehicles`, `/agency/vehicles/new`, `/agency/vehicles/[vehicleId]` (view + edit)
- `/agency/drivers`, `/agency/drivers/new`, `/agency/drivers/[driverId]`
- `/agency/trips/new?draft=` (step 1), `/agency/trips/new/pricing?draft=` (step 2)
- `/agency/trips?tab=upcoming|active|completed|cancelled|drafts`, `/agency/trips/[tripId]`
- `/agency/bookings?tab=`, `/agency/bookings/[bookingId]`
- `/agency/history?q=&type=&from=&to=`
- `/agency/earnings?tab=`
- `/agency/profile`, `/agency/profile/verification`
- `/agency/help`

### 2.5 Driver app: `/driver/*` (mobile-first)

Nav from the brief: **Dashboard (`House`), Assigned Shipments (`PackageCheck`), History (`History`), Profile (`UserRound`)**

Routes:
- `/driver/dashboard`
- `/driver/shipments?tab=pickup|transit|delivered` (assigned)
- `/driver/shipments/[bookingId]` (shipment action screen)
- `/driver/trips/[tripId]` (trip run: checkpoint arrive/depart), reached from the dashboard "Current trip" card and from shipments
- `/driver/history`, `/driver/history/[bookingId]` (read-only record)
- `/driver/profile`, `/driver/profile/documents`

**Navigation decision:** ≥lg uses the existing sidebar (4 items). **<lg replaces the hamburger + drawer with a fixed bottom tab bar** (4 items, labelled `nav "Main"`). The top bar shows logo + bell + avatar menu (logout lives there). Reasons: the brief says mobile-first with exactly 4 destinations, drivers use the app one-handed, and every action is reachable from the bottom tabs. Implement it as `DashboardShell mobileNav="bottom"` (default `"drawer"`, so customer and agency are unchanged). The bottom bar hides on `/driver/shipments/[id]` and `/driver/trips/[id]`, where a sticky action bar takes its place.

### 2.6 Reference screen → route map

| Ref | Route (v2) | Role |
|---|---|---|
| 01 landing | `/` | public |
| 02 role selection | `/signup` (3 cards) | public |
| 03–05 phone / OTP / password | `/auth/phone`, `/auth/verify-otp`, `/auth/create-password` | public |
| 06 customer dashboard | `/customer/dashboard` | customer |
| 07 available vehicles | `/customer/vehicles` | customer |
| 08 route & booking details | `/customer/booking/[tripId]` | customer |
| 09 payment | `/customer/payment` | customer |
| 10 track shipment | `/customer/tracking/[bookingId]` | customer |
| 11 driver dashboard | `/agency/dashboard` | agency |
| 12 add new route | `/agency/trips/new` | agency |
| 13 set pricing | `/agency/trips/new/pricing` | agency |
| 14 booking requests | `/agency/bookings` | agency |
| 15 earnings | `/agency/earnings` | agency |

---

## 3. Screen inventory

### 3.0 State rules (all screens)

| State | Pattern |
|---|---|
| Loading | `Skeleton` shaped like the final layout (existing `DashboardSkeleton` / per-view skeletons). Buttons use `loading` with progress text ("Publishing…") |
| Empty | `EmptyState` with a mint icon disc, one-line help and **one** CTA. Nothing is pre-filled with fake rows |
| Error (load) | `Card` with `CircleAlert`, a plain-language message and a "Try again" button. Error text uses `text-error`. Inline `FormField error` for validation. Server 409 conflicts (capacity, overlap) show a toast plus a refetch |
| Success | `useToast` success, plus an inline confirmation where the state persists (a badge changes, the timeline step fills) |
| Forbidden / wrong role | `RequireRole` redirect + info toast (existing) |
| Unverified agency/driver | `Card tone="muted"` banner with `Badge tone="attention"` "Verification pending" and a link to the documents page. Gated buttons are `disabled` with an `aria-describedby` reason |

Legend: **R** reuse as-is · **M** modify · **N** new. Responsive default: sidebar ≥lg, drawer <lg (customer/agency), bottom nav <lg (driver). Gutters and breakpoints follow ui-design-spec §7.

### 3.1 Public and auth (D1, landing D4)

| Screen | Route | St | Reuse | Key states | Responsive |
|---|---|---|---|---|---|
| Landing | `/` | M | all `features/landing/*` | Contact: sending / sent / error (real API) | §5 |
| Login | `/auth/login` | M | `LoginView`, `PhoneInput`, `PasswordInput`, `Tabs` (role) | wrong-role error ("This number is registered as a Driver. Switch to Driver login."), locked account, loading | card 440 |
| Role select | `/signup` | M | `RoleSelectView` (+1 option) | — | card 440 |
| Customer details | `/signup/customer` | N | `AuthCardHeader`, `FormField`, `Input`, `Stepper`(N) | DOB <18 error | card 440 |
| Agency details | `/signup/agency` | N | + `Select`, `RadioCard`, `ChoiceChips`(N) | validation | `AuthLayout size="wide"` (560) |
| Driver details | `/signup/driver` | N | + `Select` (agencies) | no agencies found → help text | card 440 |
| Phone / OTP / Password | `/auth/*` | M | existing views (role param, Stepper, "Dev OTP" label) | resend cooldown, attempts exceeded, expired | card 440 |
| Agency verification (onboarding) | `/agency/profile/verification` | N | `FileUpload`(N), `RadioCard`, `Badge` | upload progress / failed / pending review / verified / rejected+reason | sidebar shell |
| Driver documents (onboarding) | `/driver/profile/documents` | N | `FileUpload`(N) | same | bottom-nav shell |

### 3.2 Customer (D3)

| Screen | Route | St | Reuse | Key states | Responsive |
|---|---|---|---|---|---|
| Dashboard | `/customer/dashboard` | M | `TopBar`, `StatCard`×3, `RecentShipments`, `ShipmentForm` (as "Quick ship" card), `Button accent` | no shipments → EmptyState inside activity; stats skeleton | stats 3-col ≥sm, stacked <sm; form card + activity 2-col ≥lg |
| New Shipment | `/customer/shipments/new` | N | `Card`, `FormField`, `Input`, `Select`, `Textarea`(N), `ChoiceChips`(N), `PhoneInput`, `RadioCard`, `Stepper` (sections) | geolocation denied/unavailable; validation; saving | 1-col <md; 2-col field rows ≥md; max-w 720; sticky "Find vehicles" bar <lg |
| Find Vehicles | `/customer/vehicles` | M | `VehiclesView`, `VehicleCard`(M), `SearchSummaryBar`, `Select` (sort), `Drawer` (filters <lg), `ChoiceChips`, `Input` | 0 matches + "excluded for capacity/restriction" note (existing pattern); filter-applied empty with "Clear filters" | filters left column ≥lg (280px); "Filters (n)" button → right Drawer <lg |
| Vehicle details | `/customer/booking/[tripId]` | M | `RouteBookingView`, `RouteMap`, `BookingSummary`, `Rating`, `Avatar`, `Badge`, `CapacityBar`(N), `Modal` (confirm request) | restricted goods → CTA disabled with reason; insufficient capacity; trip departed; request sending; duplicate request → link to existing booking | 7/5 cols ≥lg, sticky summary; **sticky bottom CTA bar <lg** |
| Payment | `/customer/payment` | R/M | `PaymentView`, `PaymentMethodSelector` | provider pending → "Confirming payment…" polling; failed → retry; never shows success before server confirmation | existing |
| Booking confirmation / receipt | existing | R | — | — | existing |
| My Shipments | `/customer/shipments?tab=` | M | `ShipmentsView`, `Tabs` (7 + counts), `ShipmentListItem` | per-tab empty copy | Tabs scroll horizontally <md (existing fade) |
| Shipment details + tracking | `/customer/tracking/[bookingId]` | M | `TrackingView`, `StatusTimeline`(M: checkpoints), `BookingIdCopy`, `CancelPaidBooking`, `Avatar`, `Rating` | pending approval; rejected (reason); payment due; cancelled; delivered → feedback | 2-col ≥lg (timeline left, details right); stacked <lg |
| Feedback | inline card on tracking page | N | `RatingInput`(N), `Textarea`, `Button` | submit / submitted (read-only) / error | full width card |
| Payments history | `/customer/payments` | R | `PaymentsView` | — | — |
| Profile | `/customer/profile` | M | `ProfileView` (customer part), `ProfilePhotoCard`/`ChangePasswordCard`/`ChangePhoneModal` (N, shared) | save / OTP flow states | max-w 720 |

### 3.3 Agency (D2)

| Screen | Route | St | Reuse | Key states | Responsive |
|---|---|---|---|---|---|
| Dashboard | `/agency/dashboard` | M (from `DriverDashboardView`) | `TopBar`, `EarningsHeroCard`, `StatCard`×6, `RouteCard`, `Button accent` "Add Trip" | unverified banner; zero-data empty states; skeleton | stats 2-col <md, 3-col md, 6-col ≥xl |
| Vehicles list | `/agency/vehicles` | N | `Card`, `Badge`, `EmptyState`, `ConfirmDialog` | empty → "Add your first vehicle"; delete blocked (has upcoming trips) | grid 1/2/3 cols |
| Vehicle form | `/agency/vehicles/new`, `/[id]` | N | `FormField`, `Input`, `Select`, `FileUpload`, `ChoiceChips` | upload, duplicate registration (409), save | max-w 720, 2-col rows ≥md |
| Drivers list | `/agency/drivers` | N | `Tabs` (Active / Pending requests), `Avatar`, `Badge`, `ConfirmDialog` | empty; pending approvals | list cards; table-like row ≥md |
| Driver form/detail | `/agency/drivers/new`, `/[id]` | N | `PhoneInput`, `FileUpload`, `Input`, upcoming-assignments list | invite sent; phone already registered; remove blocked (active trip) | max-w 720 |
| Add Trip (step 1) | `/agency/trips/new` | M (from `AddRouteView`) | `FormField`, `Select`, `Input`, `CheckpointEditor`(N, feature), `ChoiceChips`, `Stepper` | overlap conflict on vehicle/driver; time-order errors; draft saving | max-w 860; sticky footer bar <lg |
| Add Trip (step 2 pricing) | `/agency/trips/new/pricing` | M (from `SetPricingView`) | `PricePreview`, `Input` ₹ prefix | publish blocked (unverified); publish / save draft | existing |
| Trips | `/agency/trips?tab=` | M (from `MyRoutesView`) | `Tabs`(5), `RouteCard`(M), `CapacityBar`, `Badge attention` | per-tab empty | 1-col <lg, 2-col ≥lg |
| Trip details | `/agency/trips/[tripId]` | N | `StatusTimeline`-style checkpoint list, `CapacityBar`, booking rows, `Select` (reassign driver), `ConfirmDialog` (cancel trip) | cancel with bookings → warn + notify; reassign overlap | 2-col ≥lg |
| Bookings | `/agency/bookings?tab=` | M (from `BookingRequestsView`) | `BookingRequestCard`(M), `Tabs`, `ConfirmDialog`, `Modal` (reject reason) | capacity conflict on accept (409); accept/reject loading | existing (cards) |
| Booking details | `/agency/bookings/[bookingId]` | N | `Card`, `StatusTimeline` (read-only), `Avatar` | contact hidden until accepted | 2-col ≥lg |
| History | `/agency/history` | N | `Input` (search), `Tabs`/`Select` (type), `DataList`(N) | no results for q; load more | table ≥md, cards <md |
| Earnings | `/agency/earnings?tab=` | M (from `EarningsView`) | `EarningsHeroCard`, `Tabs`, `DataList`, `Badge`, `WithdrawModal` (only if P2 ships payouts) | no earnings yet; settlement pending | existing |
| Profile | `/agency/profile` | M | shared account cards, `ChoiceChips` (states) | save; phone OTP | max-w 860 |
| Verification | `/agency/profile/verification` | N | `FileUpload`, `RadioCard`, `Badge` | see 3.1 | max-w 720 |
| Help | `/agency/help` | R (`HelpView`, copy edits) | — | — | — |

### 3.4 Driver app (D4)

| Screen | Route | St | Reuse | Key states | Responsive |
|---|---|---|---|---|---|
| Dashboard | `/driver/dashboard` | N (replaces operator dashboard) | `TopBar`, `StatCard`×4, `Card`, `ButtonLink` | not yet approved by agency; no trips assigned | 2×2 stats; single column ≤md, 2-col ≥lg |
| Assigned Shipments | `/driver/shipments?tab=` | N | `Tabs`(3), `Card`, `Badge`, `RouteText` | empty per tab | single column; list grouped by trip |
| Shipment action | `/driver/shipments/[bookingId]` | N | `Card`, `Modal`, `OtpInput`, `FileUpload` (camera), `Textarea`, `Badge` | action in flight (idempotent); OTP wrong; upload failed (retry keeps form); offline → error toast, never fake success | sticky bottom action bar (safe-area); bottom nav hidden |
| Trip run | `/driver/trips/[tripId]` | N | checkpoint list, `ConfirmDialog`, `Badge` | out-of-order prevented; event recorded with timestamp | sticky "Mark arrived/departed" bar |
| History | `/driver/history` | N | `Input` search, `Select` month, `Card` list | empty | single column |
| History record | `/driver/history/[bookingId]` | N | read-only shipment action layout + proof thumbnail | — | — |
| Profile | `/driver/profile` | N (replaces operator profile) | shared account cards, `Rating`, reviews list | pending agency approval | max-w 720 |
| Documents | `/driver/profile/documents` | N | `FileUpload` | see 3.1 | — |

---

## 4. Specs for new and changed screens

Conventions: page = `PageHeader` (back arrow on sub-pages) or `TopBar` (dashboards). Section = `Card as="section" aria-labelledby` with a `type-h3` heading. Forms use react-hook-form + zod (existing pattern, `src/lib/schemas/*`). The server re-validates everything. All IDs and money use `tabular-nums`.

### 4.1 New shared primitives (D1 builds in Wave 0; everyone else consumes them)

| Component | Location | API sketch | Notes |
|---|---|---|---|
| `Textarea` | `ui/Textarea.tsx` | Input-like, `rows`, `maxLength` + counter | Reuse `fieldBoxClasses` |
| `Checkbox` | `ui/Checkbox.tsx` | native checkbox + label/description | Terms, special handling |
| `ChoiceChips` | `ui/ChoiceChips.tsx` | `options[]`, `value[]`/`value`, `multiple`, `legend` | `fieldset` + native checkbox/radio styled as `Chip` pills; selected = mint-100 + green-800 + `Check` icon. Used for states covered, goods categories, vehicle-type filter, special handling |
| `FileUpload` | `ui/FileUpload.tsx` | `accept`, `maxSizeMb`, `capture?`, `value` (`{name, url?, status}`), `onSelect(file)`, `onRemove`, `kind: "image"\|"document"` | Dropzone card (dashed `border-strong`, `Upload` icon) plus a "Choose file"/"Take photo" button. Image preview thumb, progress bar, error (type/size), "Stored privately — visible only to you and TAKI verification" hint with `Lock`. Private files go through plain `<img>` with short-lived signed URLs, **never `next/image`** (its optimiser caches) |
| `Stepper` | `ui/Stepper.tsx` | `steps: string[]`, `current` | `<ol>` with `aria-current="step"`. Compact text "Step 2 of 4 · Verify phone" <sm, dots + labels ≥sm. Current dot coral-400, done green-700 |
| `CapacityBar` | `ui/CapacityBar.tsx` | `totalKg`, `bookedKg`, `reservedKg?` | `role="meter"`, label "1,200 of 3,000 kg booked · 1,800 kg left". Booked green-700, reserved green-300, free border |
| `RatingInput` | `ui/RatingInput.tsx` | `value`, `onChange`, `name` | 5 radio stars (radiogroup), 44px targets, star `#F4B524` |
| `DataList` | `ui/DataList.tsx` | `columns`, `rows`, `renderMobile(row)` | `<table>` ≥md, `<ul>` of cards <md, "Load more" slot |
| `Button` `accent` / `Badge` `attention` | existing files | see §1.4 | — |
| `BottomNav` | `layout/BottomNav.tsx` | `nav: NavItem[]` | Fixed bottom, `bg-sage-900`, 4 tabs 64px tall plus safe-area. Active = lime-300 icon + label + top indicator, `aria-current="page"` |
| `DashboardShell` | M | `role` gains `agency`; `mobileNav?: "drawer"\|"bottom"`; `hideBottomNav` via path list | Sidebar `nav` gets `min-h-0 overflow-y-auto` (10 agency items) |
| `TopBar` | M | role-aware `profileHref` and notification links (customer → tracking, agency → `/agency/bookings/[id]`, driver → `/driver/shipments/[id]`) | — |
| `RequireRole`, `nav.ts`, `routes.ts` | M | add `agencyNav`, the new `driverNav`, every path in §2, `dashboardFor('agency')` | — |
| `AuthLayout` | M | `size?: "default"\|"wide"` (440/560) | — |
| Account cards | `features/account/*` (N) | `ProfilePhotoCard`, `ChangePasswordCard`, `ChangePhoneModal` (PhoneInput → OtpInput → done), `DocumentList` (masked numbers, status badges) | Used by all three profiles |

### 4.2 Auth: signup per role (D1)

**Shared:** `Stepper` at the top of the card. Back arrow goes to the previous step. The details are held by the server signup session from P2 (or by a short-lived client draft if P2 says so). DOB `Input type="date"` uses `max = today − 18y`, and the zod check is "You must be 18 or older to use TAKI".

| Role | Step 1 fields (route) | Steps 2–3 | Step 4 (in shell) |
|---|---|---|---|
| Customer | Full name*, Date of birth* (18+), agree to Terms `Checkbox`* | Phone → OTP → Password + confirm (existing rules list) | — (lands on dashboard with a welcome toast) |
| Agency | Owner name*, Agency name*, District* (`Select`, grouped by state), Vehicle count* (`RadioCard` row or `ChoiceChips` single: 1–5 · 6–10 · 11–25 · 26–50 · 50+), States covered* (`ChoiceChips` multi: Tamil Nadu, Kerala, Karnataka, Telangana, Andhra Pradesh; min 1), Terms* | same | **Verification:** ID type `RadioCard` (Aadhaar / PAN / Driving licence) → number (`Input`, masked display `XXXX XXXX 1234`) → `FileUpload` (front, plus back for Aadhaar/DL) → Owner photo `FileUpload kind=image capture="user"` → "Submit for verification". Status card: Pending review / Verified / Rejected (reason + re-upload) |
| Driver | Full name*, Associated agency* (`Select` of verified agencies, "Agency name — District"; helper "Not listed? Ask your agency to add you."), Terms* | same | **Documents:** Driving licence (number + file), Aadhaar (number + file), Profile photo (camera). Status "Waiting for <Agency> to approve you" |

Login (`/auth/login`): role `Tabs` above the form ("Customer · Travel agency · Driver"). The `?role=` param syncs both ways. Copy for "Forgot password?" and "Create an account" carries the role through. The existing demo-credentials banner goes away when the backend is real.

### 4.3 Customer

**Dashboard (M).** `TopBar` "Hi, {first name}" plus "Where are we shipping today?"
1. Row of 3 `StatCard`s: Active shipments (`Truck`), Completed (`PackageCheck`), Pending bookings (`Clock`, value badge `attention` if >0). Each links to `/customer/shipments?tab=…`.
2. "Quick ship" card. The existing `ShipmentForm` stays as the quick start: city-level source/destination, weight, date. Submit becomes **"Continue"** and routes to `/customer/shipments/new?from=&to=&weight=&date=` (prefill). Next to it is a `Button variant="accent"` "New Shipment" (`PackagePlus`).
3. "Recent activity" `Card`: `RecentShipments` plus latest tracking events (last 5), each linking to the details page. Empty: "No activity yet".

**New Shipment (N): `/customer/shipments/new`.** One page with 4 section cards (a `Stepper` is shown only as an anchor index ≥lg):

| Section | Fields |
|---|---|
| Pickup (Source) | Toggle `ChoiceChips` single: **Use current location** / **Enter manually**. Current location calls `navigator.geolocation`, then shows "Location captured (±30 m)" with coordinates and fills district/state only if P2 provides a reverse-geocode adapter. The user still confirms the full address. Denied/unavailable shows an inline info message and switches to manual. Fields: Full address* (`Textarea` 2 rows), District* (`Select` from the **same district list trips use as checkpoints**, otherwise matching breaks), Pincode* (6 digits, `inputMode=numeric`), State* (`Select`) |
| Delivery (Destination) | Full address*, District*, Pincode*, State* (same controls) |
| Receiver | Receiver name*, Receiver phone* (`PhoneInput`). Checkbox "I am the receiver" copies the profile |
| Package | Weight* (`Input` + kg/t `Select`, existing pattern), Package type* (`Select`: Box/carton, Bag/sack, Crate, Pallet, Documents/envelope, Loose/other), Goods category* (`Select`: P2 goods list, drives restriction matching), Goods description* (`Textarea`, 200 chars), Shipping date* (date ≥ today), Special handling (`ChoiceChips` multi: Fragile, Keep dry, Perishable, This side up, Needs loading help) |

Footer: "Find vehicles" primary (sticky bar <lg). Submit saves the shipment server-side and navigates to `/customer/vehicles?shipment=<id>`. Validation errors focus the first invalid field. Pincode/district mismatch is a warning, not a block (the server decides).

**Find Vehicles (M).** Header: `SearchSummaryBar` (Coimbatore → Chennai | 500 kg | 20 Nov) plus "Edit shipment".
- Filters (left panel ≥lg / `Drawer` <lg with "Apply" and "Clear all"; active count on the "Filters" button): Vehicle type (`ChoiceChips` multi), Price (₹ min / ₹ max `Input`s), Departure date (date input, default = shipping date), Min. available capacity (kg `Input`, never below shipment weight). All of these live in the URL query.
- Sort `Select`: Best match (existing default), **Lowest price, Highest price, Earliest departure, Earliest arrival**, Top rated, Most capacity.
- `VehicleCard` (M) adds: agency name + `BadgeCheck`, driver `Avatar` + name + `Rating`, route line with checkpoints where the pickup/drop districts are bold and the others muted (`RouteText`), departure → arrival datetimes, available capacity, price estimate (existing), badge (existing). CTA "View details".
- Only server-matched trips are shown. Keep the existing "n vehicles hidden: not enough space" note and add "…restricted goods".

**Vehicle details (M): `/customer/booking/[tripId]`.** Title "Vehicle details". Left column ≥lg, in order:
1. **Overview**: vehicle image, type/model, registration, body type, `CapacityBar`.
2. **Route**: `RouteMap` (keep the "Illustrative route — not live location" note) plus a checkpoint list with expected arrival/departure. Pickup and drop are highlighted.
3. **Driver**: Avatar/photo, name, rating, trips completed. The phone is hidden ("Shared after the agency accepts").
4. **Driver reviews**: average + count, latest 3 (`Rating`, comment, date, first-name initial), "Show all" → `Modal` paginated. Empty: "No reviews yet".
5. **Agency**: name, verified badge, district, states covered, member since.
6. **Restrictions**: accepted goods chips (success) and restricted chips (neutral with `Ban` icon). If the shipment's category is restricted, show an inline error and disable the CTA.

Right column (sticky ≥lg / sticky bottom bar <lg with total + CTA): **Cost breakdown** (extended `BookingSummary`): Distance charge `498 km × ₹12/km`, Weight charge `500 kg × ₹0.50/kg`, each extra charge on its own named line (service fee, plus any P2-defined handling surcharge), Total payable. Note: "You pay only after the agency accepts." CTA "Request booking" opens a `Modal` confirm with the shipment summary. Submit → `/customer/tracking/[id]` with the Pending state (this is the Phase-1 behaviour, kept).

**My Shipments (M).** `Tabs` with counts and `?tab=` sync:

| Tab | Booking statuses (final names per P2) | Row actions |
|---|---|---|
| Pending | awaiting agency approval, accepted · payment due, payment failed | "Pay now" (`Badge attention` "Payment due"), "Cancel request" |
| Confirmed | paid/confirmed | View, Cancel (before pickup) |
| Picked Up | picked_up | View |
| In Transit | in_transit, at checkpoint, out_for_delivery | Track |
| Delivered | delivered | "Rate delivery" if not rated |
| Rejected | rejected by agency, expired unanswered | View reason |
| Cancelled | cancelled (any party) | View |

Default tab: the first non-empty of Pending, Confirmed, In Transit, otherwise Pending. Rows use the existing `ShipmentListItem`.

**Shipment details + tracking (M): `/customer/tracking/[bookingId]`.** Title "Shipment {TAKI…}" with `BookingIdCopy` and a status `Badge`.
- Left column: **Tracking timeline** (`StatusTimeline` M): Booking requested → Accepted by agency → Payment confirmed → Picked up → In transit → *checkpoint sub-steps* ("Arrived Salem 12:10 · Departed 12:42"; upcoming ones show "Scheduled 14:30" in ink-subtle and are never shown as done) → Out for delivery → Delivered (with "Proof of delivery" thumbnail and driver remarks). Terminal Rejected/Cancelled replaces the remaining steps with a reason row. "View live route" appears **only** if P2 exposes authorised GPS; otherwise it is absent (not disabled).
- Right column: **Driver** (after acceptance: name, photo, phone `tel:` link, rating), **Vehicle** (type, reg), **Receiver**, **Route** (pickup/drop addresses), **Booking** (date, package, special handling, price breakdown, payment status + receipt link), **Pickup/Delivery OTP** card (existing).
- Actions: Pay now (payment due), Cancel (only before pickup: `ConfirmDialog`, existing `CancelPaidBooking` for refunds).
- **Feedback** (Delivered and not rated): `Card` "How was your delivery?" with `RatingInput`*, `Textarea` comment (optional, 500), Submit. After submit it shows the read-only rating plus "Thanks for your feedback". One per shipment.

**Profile (M).** Cards: `ProfilePhotoCard`, Personal details (name, DOB read-only after signup, email optional), Mobile (read-only + "Change" → `ChangePhoneModal`: new number → OTP → saved), `ChangePasswordCard` (current, new, confirm), Payment history link. "Demo account" copy is removed.

### 4.4 Agency

**Dashboard (M from `DriverDashboardView`).**
- `TopBar` "Hi, {owner}" with subtitle = agency name.
- Verification banner if not verified.
- `EarningsHeroCard` (revenue this month, sparkline from real settlements; with 0 data it shows ₹0 and the copy "Revenue appears after your first delivery").
- `StatCard` grid: Vehicles, Drivers, Active trips, Upcoming trips, Pending bookings (attention if >0), Completed shipments, each linking to its list.
- `Button accent` "Add Trip" (replaces "Post a New Route", `Plus`).
- Two cards ≥lg: "Upcoming trips" (`RouteCard` ×3, View all) and "Recent activity" (latest notifications: requests, payments, deliveries).

**Vehicles (N).** List of cards: photo (16:10, fallback = vehicle-class illustration from `public/assets/taki/vehicles`), type/model, registration, max capacity, body type, restriction chips (max 3 + "+n"), status `Badge` (Active / On trip / Inactive). Actions: Edit, Remove (`ConfirmDialog`; blocked with a reason if it has upcoming trips). Header action "Add vehicle".
Form fields:
- Vehicle type* (`Select` vehicle class/model)
- Registration number* (normalised "TN 37 XX 4587", unique)
- Photo* (`FileUpload image`)
- Max capacity kg*
- Body type* (`RadioCard`/`ChoiceChips`: Open, Tarpaulin, Closed, Container)
- Goods restrictions (`ChoiceChips` multi: categories this vehicle cannot carry)
- Specs: make/model, year, cargo length × width × height (m), notes (`Textarea`)

**Drivers (N).** `Tabs`: Active · Pending requests (drivers who self-registered and chose this agency).
- Row: `Avatar`/photo, name, phone (masked for others; full for the agency), licence no. (masked), document status, current/next assignment.
- Actions: View/Edit, Remove (blocked if on an active trip), Approve/Reject for pending.
- "Add driver" form: Name*, Phone* (`PhoneInput`), Photo, Driving licence no.* + file, Aadhaar no.* + file. Copy: "The driver signs in with this phone number; we'll ask them to set a password via OTP." P2 confirms the invite mechanism.
- Driver detail shows the assignments timeline used for the overlap check.

**Add Trip, step 1 (M from `AddRouteView`): `/agency/trips/new?draft=`.** `Stepper` (1 Trip details · 2 Pricing). Sections:
1. **Vehicle & driver**: Vehicle* `Select` (options show capacity; vehicles busy in the chosen window are `disabled` with "(on trip 20 Nov 08:00 – 21 Nov 02:00)"), Driver* `Select` (same overlap rule; only approved drivers). Server conflict → field error "Ravi is already assigned to trip T-0012 during this time."
2. **Route & checkpoints** (`CheckpointEditor`, feature component): a fixed **Source** row (District* + Departure date-time*), ordered **checkpoint rows** (District* · Expected arrival* · Expected departure* · Up/Down `IconButton`s labelled "Move Salem up" · Remove `X`), "+ Add checkpoint" (`Chip variant="add"`, max 10), and a fixed **Destination** row (District* + Arrival date-time*). Inputs are `datetime-local`. Validation: strictly increasing times; arrival ≤ departure per stop; no repeated district; the km from source per row is read-only once the server computes it. Mobile: each row is a stacked mini-card. This replaces the `StopChipsInput` chips because times are now required.
3. **Capacity & goods**: Max capacity kg* (prefilled from the vehicle, ≤ vehicle max), Capacity available for booking kg* (≤ max), Accepted goods* (`ChoiceChips` multi, default = all except vehicle restrictions), Restricted goods (read-only chips = everything else) + "Other restrictions" `Textarea`.

Footer: "Save draft" (outline) and "Next: Pricing" (primary). Both create/update the server draft.

**Add Trip, step 2 (M from `SetPricingView`).** Per km ₹*, Per kg ₹* (existing inputs with ₹ prefix and /km, /kg suffix), `PricePreview` (existing). Optional extra charges only if P2 defines them. Actions: "Save draft" and **"Publish trip"**. Publish is disabled with a reason when the agency is unverified. Success → `/agency/trips?tab=upcoming&published=<id>` (existing highlight pattern).

**Trips (M from `MyRoutesView`).** `Tabs`: Upcoming · Active · Completed · Cancelled · Drafts. `RouteCard` (M):
- Route with checkpoints, departure → arrival
- Vehicle reg + type, driver avatar + name
- `CapacityBar` (booked vs remaining)
- `Badge attention` "{n} pending requests"
- Status badge
- Drafts: "Continue editing" + Delete

**Trip details (N).**
- Header: route + status.
- Left: checkpoint list with expected vs actual times (actuals come from driver events).
- Right: vehicle, driver (`Select` "Reassign" with overlap check), `CapacityBar`, bookings on this trip (rows → booking details).
- Actions: "Cancel trip" (`ConfirmDialog` with a list of affected bookings; the notification copy states customers are notified and refunds follow P2 rules).

**Bookings (M from `BookingRequestsView`).** `Tabs`: Pending · Accepted (awaiting payment) · Confirmed · Rejected · Cancelled/Expired.
- `BookingRequestCard` (M) shows: customer name, pickup → drop districts, weight, package type, category, special-handling chips, shipping date, trip (vehicle + departure), earnings, "Capacity after accepting: 1,700 kg".
- **Accept** → `ConfirmDialog` "Reserve 300 kg on TN 37 XX 4587?". On a 409 (capacity gone): error toast "Not enough space left — capacity changed", card refreshes.
- **Reject** → `Modal` with reason `Select` (No space / Goods not accepted / Schedule change / Other + note) → customer notified.
- After accept the card shows "Customer & receiver details shared with {driver}".
- The existing pickup/delivery OTP buttons **move to the driver app**. Agency cards become read-only status after Confirmed.

**Booking details (N).** Customer (phone only after acceptance), receiver, addresses, package, trip, price, payment status, read-only timeline.

**History (N).** `Input` search (`Search` icon, 300 ms debounce, `?q=`), type `Select` (All, Trips, Shipments, Vehicles, Drivers, Customers), date range (two date inputs). `DataList`: type icon, primary label (booking ID / reg / name), secondary meta, date, status badge → links to the detail page. Load more pagination. Empty: "No results for '{q}'". Initial state: the latest 20 records.

**Earnings (M from `EarningsView`).**
- Top: `EarningsHeroCard` total earned, plus StatCards: This month, Pending settlement, Settled.
- `Tabs`: Trips (trip-wise totals) · Bookings (booking-wise: amount, fee, net, status) · Payments (customer payments received: method label masked, status) · Settlements (payouts: amount, status Processing/Completed/Failed, date).
- "Recent transactions" (5) on the first tab.
- `WithdrawModal` is kept only if P2 implements payouts; otherwise settlements are read-only.
- Empty states everywhere, no seeded numbers.

**Profile (M).**
- Agency details card: owner, agency name, district, states (`ChoiceChips`), vehicle count range, logo/photo.
- Verification card: status badge, documents list (masked), "Update documents" → `/agency/profile/verification`.
- Mobile (`ChangePhoneModal`), `ChangePasswordCard`.
- Management shortcuts: "Vehicles (4)" and "Drivers (6)" links.

### 4.5 Driver app (mobile-first, single column, 44px+ targets, sticky actions)

**Dashboard.**
- Top bar: logo, bell, avatar.
- `TopBar` greeting "Hi, {name}" with subtitle = agency name.
- If the agency has not yet approved the driver: `Card tone="muted"` "Waiting for {agency} to approve you", and everything else is hidden.
- 2×2 `StatCard`: Active trips, Pending pickups, In transit, Completed deliveries.
- **Current trip** `Card tone="brand"`: route, next checkpoint + expected time, `CapacityBar`, "Open trip" (lime) → `/driver/trips/[id]`.
- "Next actions" list: pickups due today (address district, time) → shipment action.
- Empty: "No trips assigned yet. Your agency will assign you to trips."

**Assigned Shipments.** `Tabs`: To pick up · In transit · Delivered today. Grouped by trip (trip header row: route + departure).
- Card: booking ID, customer name, receiver name, pickup → drop (district + short address), package (weight, type, special-handling icons), status badge.
- Tap → action screen.

**Shipment action (`/driver/shipments/[bookingId]`).**
- Header: back, booking ID, status badge.
- Sections:
  - Customer (name, `tel:` call button)
  - Receiver (name, call button)
  - Pickup address and Drop address (each with "Open in Maps" external link)
  - Package (weight, type, description, special-handling chips)
  - Trip / vehicle
  - Checkpoints (compact)
- **Sticky bottom action bar** by state:

| State | Primary action | Sheet (`Modal`) contents |
|---|---|---|
| Confirmed (paid) | **Confirm pickup** | Pickup OTP (`OtpInput`, from the customer), optional photo, remarks → "Confirm pickup" |
| Picked up / In transit | **Mark out for delivery** (when at the drop district) | Remarks optional |
| Out for delivery | **Confirm delivery** | Delivery OTP*, Proof photo* (`FileUpload image capture="environment"`), Received by (name), Remarks (`Textarea`) → "Confirm delivery" |
| Delivered | — | Read-only proof + timestamp |

Every event shows "Recorded {time}" once the server acknowledges it. Buttons stay `loading` until then, and a retry never duplicates the event (idempotency key from P2). Checkpoint arrive/depart lives on the trip screen because it applies to the whole vehicle.

**Trip run (`/driver/trips/[tripId]`).** A vertical list: Source → checkpoints → Destination. Each row shows expected arrival/departure, actual times when recorded, a delta badge (`+25 min`, neutral/attention), and the shipments **picked up here / dropped here** (links). The current row is highlighted (`Card tone="selected"`). Sticky bar: "Start trip" (depart source), then "Arrived at {checkpoint}", then "Departed {checkpoint}", …, then "Arrived at destination". Each needs a `ConfirmDialog` and must happen in order (the next row is disabled until the previous event exists). Errors keep the button enabled with a toast.

**History.** Search booking ID, month `Select`, list of delivered shipments (date, route, receiver, proof thumbnail). Tap → read-only record.

**Profile.** `ProfilePhotoCard`, details (name, phone via `ChangePhoneModal`), Agency card (name, status), Documents (`DocumentList`: licence, Aadhaar masked, status) → `/driver/profile/documents`, Rating summary + reviews list, `ChangePasswordCard`, Log out (also in the avatar menu).

---

## 5. Landing page: deltas against brief §A only

| # | Brief item | Current | Delta |
|---|---|---|---|
| 1 | Navbar: logo, How It Works, Benefits, About, Contact, Login | ✓ (`SiteHeader` defaults) | None. Login → `/auth/login` (role tabs) |
| 2 | Hero, transport background, exact headline | ✓ (`HERO.titleLines`) | None |
| 3 | Description + CTAs Ship Goods / List a Route | ✓ | "Ship Goods" → `variant="accent"` (coral). `LandingCta` "route" intent: signed-out → `/signup/agency`, agency → `/agency/trips/new`. "ship" intent: signed-in non-customer → `/signup/customer` |
| 4 | How TAKI Works: Find a Route, Choose a Vehicle, Ship with Ease | ✓ | None (keep the honest "track every step" copy) |
| 5 | Benefits for customers **and agencies** | audience "For drivers" | Rename the audience to "For agencies". Rewrite the 2 driver benefits (e.g. "Fill spare capacity on trips your fleet already runs", "Manage vehicles, drivers and bookings in one place") |
| 6 | Goods categories with images | Inside Benefits ("What you can ship"), 4 `public/assets/taki/cargo/*.webp` (same files as `TAKI_Website_Images_Original_Logo/TAKI_Website_Assets/cargo`) | Optional: promote to its own `<section id="goods">` "Supported goods" with the same tiles. No new assets |
| 7 | Two-sided marketplace | `AudienceSplit` customers / "lorry drivers" | Second card → "For travel agencies"; `DRIVER_JOURNEY` → agency steps (register vehicles & drivers → publish trips with checkpoints & rates → accept bookings, track earnings). Add a small link under it: "Driving for an agency? Sign up as a driver" → `/signup/driver` |
| 8 | Contact form | Validates, then toasts "not delivered (demo)" | Wire to a real endpoint (P2 `POST /api/contact`, rate-limited). States: sending / sent / error. Remove the demo copy |
| 9 | Footer | Get-started links: customer, driver, login | Links: Ship goods (customer signup), Register your agency, Driver sign-up, Log in. `About` copy: service area = TN, KL, KA, Telangana, AP (`ABOUT_CITIES` is TN-only) |
| — | Responsiveness | Hero tested at 768–1279, mobile | Re-check the 360px hero with the coral CTA; no other known gaps |

---

## 6. Responsive issues

| # | Issue | Type | Action |
|---|---|---|---|
| 1 | Sidebar E2E tests fail below `lg` (nav lives in the drawer) | **Test issue.** `aside` is `display:none` <lg by design | Tests use one helper `openMainNav(page)` that clicks "Open menu" if the `aside` is hidden (the pattern already exists in `driver-journey.spec.ts:65`). Driver-app tests need no helper: the bottom nav is the only visible `nav "Main"` <lg |
| 2 | `DashboardSidebar` `nav` has no overflow handling. With 10 agency items on short viewports (1024×600 landscape tablets, zoomed laptops), Log out is pushed off-screen | Real | `nav`: `min-h-0 overflow-y-auto`; logout stays pinned |
| 3 | Vehicle details: "Request Booking" is only at the bottom on mobile (screenshot 08-mobile). ui-design-spec §7 requires a sticky bottom CTA, and the page gets much longer in v2 | Real | Sticky bottom bar <lg with total + CTA (safe-area padding) |
| 4 | `ink-subtle` fails AA on the new sage canvas (4.14) and already fails on `surface-muted` (4.42) | Real (a11y) | Token change §1.4 |
| 5 | Mobile top bar (`bg-green-950`) will clash with the new sage sidebar | Visual | `bg-sage-900` (§1.4) |
| 6 | New wide data (history, earnings, agency drivers) would overflow at 360px | Prevent | `DataList` (cards <md) |
| 7 | `datetime-local` inputs overflow narrow cards on iOS Safari | Prevent | `w-full min-w-0`. Checkpoint rows stack <md |
| 8 | Tabs with 7 items (My Shipments) at 360px | OK | Existing `Tabs` already scrolls with edge fades and scrolls the selected tab into view |
| 9 | Driver app at <lg | New | Bottom nav (64px + safe-area). Page `pb-24` so content clears it. Hidden on action screens |

---

## 7. File ownership (D1–D4)

**Rule:** one owner per file. Shared foundations land first (**Wave 0**, D1) as small PRs/commits. Others ask D1 via SendMessage for changes to shared files instead of editing them. Domain types, labels, schemas shared with the server, `lib/services/**` and API routes belong to **P2/backend**. UI devs consume them and do not edit.

| Owner | Owns (create/modify) | Notes |
|---|---|---|
| **D1 (auth + shared UI foundation)** | `src/app/globals.css`; `src/components/ui/**` (new: Textarea, Checkbox, ChoiceChips, FileUpload, Stepper, CapacityBar, RatingInput, DataList; edits to Button/Badge/IconButton); `src/components/layout/**` **except** SiteHeader/SiteFooter (DashboardShell agency + bottom nav, BottomNav, DashboardSidebar overflow, TopBar role links, RequireRole, AuthLayout wide, MobileNavDrawer); `src/lib/config/nav.ts`, `src/lib/config/routes.ts` (all v2 paths up front); `src/app/(auth)/**`; `src/features/auth/**`; new `src/app/(auth)/signup/{customer,agency,driver}/`; new `src/features/account/**` (ProfilePhotoCard, ChangePasswordCard, ChangePhoneModal, DocumentList); `tests/e2e/auth.spec.ts` | Wave 0 deliverable (first): tokens, Button/Badge variants, the new primitives, shell role/agency + bottom nav, nav.ts/routes.ts with every route in §2 (pages may 404 until owners build them) |
| **D2 (agency)** | `src/app/agency/**` (new layout: `DashboardShell role="agency"` + `RequireRole`); new `src/features/agency/**` (vehicles, drivers, trip details, CheckpointEditor, history, booking details, AgencyProfileView, verification); existing operator features it inherits: `src/features/{driver-dashboard,driver-routes,driver-requests,pricing,earnings,help}/**`, `src/features/profile/VehicleList.tsx`; `next.config.ts` **redirects block only**; `tests/e2e/{driver-journey,driver-routes,driver-requests}.spec.ts` (repoint to /agency) | Keep the old folder names to avoid churn (import paths stay valid); rename later if wanted. Must not touch `src/app/driver/**` |
| **D3 (customer)** | `src/app/customer/**`; `src/features/{customer-search,booking,payment,payments,shipments,tracking}/**`; `src/features/profile/ProfileView.tsx` (becomes customer-only; agency/driver get their own views); new `src/features/customer-shipment/**` (NewShipmentView); `tests/e2e/{customer-journey,customer-search,booking,booking-flow,payment-tracking}.ts` | `StatusTimeline` stays D3-owned. If D2/D4 need a read-only timeline they import it unchanged or ask D3 |
| **D4 (driver app + landing)** | `src/app/driver/**` (rewrite: layout with `mobileNav="bottom"`, new pages; delete the old operator pages only **after** D2's `/agency` equivalents + redirects land); new `src/features/driver-app/**`; `src/features/landing/**`; `src/components/layout/SiteHeader*.tsx`, `SiteFooter.tsx`; new `tests/e2e/driver-app.spec.ts` | Landing is small (copy + CTA routing + contact wiring) and balances D4's load |
| **Shared/QA (lead)** | `tests/e2e/{responsive-a11y,visual,integration}.spec.ts`, `test-results/visual/*` re-baseline | After Wave 0 and at the end |

**Sequencing:**
1. D1 Wave 0.
2. D2 and D3 in parallel.
3. D4 driver app in parallel (it depends only on Wave 0 plus P2 APIs).
4. D4 removes the old `/driver` operator pages after D2 confirms the `/agency` routes work.

### Open questions for lead / P2 (they block UI details, not the plan)
1. Who approves agency verification? The brief has no admin role. Options: a Firestore console/script, or a hidden `/admin` page.
2. Driver onboarding: does the agency invite by phone, the driver self-register choosing an agency, or both (the plan supports both)?
3. Final booking status names and the mapping to the 7 customer tabs (§4.3 table).
4. Canonical district list (shared by trip checkpoints and shipment addresses), the goods-category list, and whether reverse geocoding exists.
5. Extra charges beyond the service fee (handling surcharge, GST line?) for the cost breakdown.
6. Payout/withdraw for agencies in v2, or settlements read-only?
7. Can one phone number hold accounts in more than one role? This affects login error copy.
