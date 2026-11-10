# Screen Inventory — TAKI Travel (P1)

Text in "quotes" is verbatim from the board (crops `references/screens/NN-*.png`). `[fix]` marks garbled/inconsistent mock text with the corrected value; `[demo]` marks copy that must change in demo mode. Routes follow `technical-architecture.md` §2. Component names follow `ui-design-spec.md` §5.
Sample data on the board (Arjun, Ravi, Raj Transport…) is seed data only (P3 owns it) — never hardcode in components.

---
## 01 Landing — `/`
**Sections**
1. `SiteHeader` (transparent over hero): Logo; links "How it Works", "Benefits", "About", "Contact"; white pill button "Login".
2. `HeroSection` (photo `hero/login_truck_mountain_photo.webp`, truck right, dark-green overlay left):
   - Eyebrow pill: "Smart Logistics Marketplace"
   - H1 (2 lines): "Your goods. Their route." / "One smart connection."
   - Sub (2 lines): "Find available vehicles travelling your way." / "Ship your goods without booking an entire truck."
   - CTAs: lime "Ship Goods →" (→ `/signup?role=customer`, or `/customer/dashboard` if signed in as customer); ghost-dark "List a Route" (→ `/signup?role=driver`).
3. `HowItWorksCard` (white, r-xl, overlaps hero bottom by ~48px on desktop) id `how-it-works`:
   - Title "How TAKI Works"
   - Step 1 `Search` "Find a Route" — "Search for vehicles on your route."
   - Step 2 `Truck` "Choose a Vehicle" — "Compare, check details and book."
   - Step 3 `Package` "Ship with Ease" — "Pay online and track in real time." `[demo]` → "Pay online and track every step." (no "real time" claim until live tracking exists)
   - `ArrowRight` separators between steps (decorative).
4. Extra sections (no board reference — see "Landing extras" below): Benefits, About, Contact, Footer.

**Layout** — Desktop ≥1024: hero min-height 640, text column max 600 left; how-it-works card = title column + 3 step columns with arrows. Tablet: hero 560, image `object-position: 70% center`; steps 3-col without title column (title above). Mobile: header hamburger; hero 560+ with vertical overlay (`grad` 180°), CTAs full-width stacked; steps stacked vertically, arrows rotate 90° or hide.
**States** — Header solid on scroll; CTA hover/focus; image `priority` + `sizes="100vw"`.

## 02 Role selection — `/signup`
`AuthLayout` (no back arrow on board; add back to `/` for usability).
- H1 "Join TAKI Travel"; sub "Choose how you want to use TAKI"
- `RoleCard` customer (shown selected: green border): icon `Package`, "I'm a Customer", "I want to ship goods", `ArrowRight`
- `RoleCard` driver: icon `Truck`, "I'm a Lorry Driver", "I want to list my route and earn", `ArrowRight`
- Add below cards: "Already have an account? Log in" (→ `/auth/login`) — not on board, needed for flow.
**Behaviour** — Cards are links/buttons (`role` stored then → `/auth/phone`). Pre-select from `?role=`. Hover = selected style. Keyboard: Tab between cards, Enter activates.
**Layout** — Card 440 centred, vertical centring on desktop; mobile full-width card with 16 gutter (or card edge-to-edge with no shadow <400px).

## 03 Mobile number — `/auth/phone`
- Back `ArrowLeft` (→ `/signup`); Logo
- H1 "Enter your mobile number"; sub "We'll send you a one-time password (OTP) for verification." `[demo]` → "We'll generate a one-time password (OTP) to verify your number." + `DemoBanner` "Demo mode — no SMS is sent. Your code will be shown on the next screen."
- `PhoneInput`: India flag, "+91", placeholder "Enter mobile number"
- Primary full-width "Send OTP"
**Validation** — 10 digits, starts 6–9: "Enter a valid 10-digit mobile number". Loading "Sending…" `[demo]` "Generating…".

## 04 Verify OTP — `/auth/verify-otp`
- Back, Logo; H1 "Verify OTP"
- "Enter the 6-digit code sent to" `[demo]` → "Enter the 6-digit code for" ; bold line "+91 98765 43210" (formatted phone, "+91" in green-700)
- `OtpInput` 6 boxes (board sample "4 2 8 6 1 9")
- "Resend OTP in **00:24**" (countdown; at 0 becomes link-button "Resend OTP")
- Primary "Verify" (disabled until 6 digits; auto-submit optional)
- `DemoBanner` above input: "Demo mode — no SMS is sent. Your code is 482619" (`data-testid="demo-otp-code"`)
- Add: "Change number" link → `/auth/phone`.
**States** — invalid ("Incorrect code. 4 attempts left."), expired, locked (5 attempts), resend cooldown, verifying.

## 05 Create password — `/auth/create-password`
- Back, Logo; H1 "Create a Password"; sub "Set a password to secure your account."
- `PasswordInput` placeholder "Enter password"; `PasswordInput` placeholder "Confirm password" (visible labels "Password"/"Confirm password" for a11y — sr-only acceptable)
- Live checklist (`Check` green when met, `Circle` muted when not; `aria-live="polite"`): "At least 8 characters", "One uppercase letter", "One number"
- Primary "Create Account" → role dashboard + toast "Account created".
**Errors** — "Passwords do not match".

## 06 Customer dashboard — `/customer/dashboard`
`DashboardShell` customer nav: "Home" (active), "My Shipments", "Payments", "Profile". TopBar: `Bell`, Avatar.
- `GreetingHeader` "Hi, Arjun 👋"; sub "Where are we shipping today?"
- Card `ShipmentSearchForm` title "New Shipment":
  - "Source" — `MapPin` input, value "Coimbatore, Tamil Nadu"
  - "Destination" — `MapPin` input, value "Chennai, Tamil Nadu"
  - "Cargo Weight" — number "500" + unit select "kg"
  - "Pickup Date" — `Calendar` date "20 Nov, 2025"
  - Primary full-width "Find Available Vehicles →" → `/customer/vehicles?from=…&to=…&kg=…&date=…`
**Layout** — Desktop: form card max 720 left-aligned; optional right column (≥1280) "Recent shipments" mini-list. Weight/date 2-col ≥640, stacked below.
**Validation** — same city: "Source and destination must differ"; weight 1–max; date ≥ today.

## 07 Available vehicles — `/customer/vehicles`
- `PageHeader` back → dashboard, "Available Vehicles (3)"
- `RouteSummaryBar`: "Coimbatore → Chennai | 500 kg | 20 Nov, 2025" (+ "Edit" link, not on board)
- `VehicleCard` ×3 (image left, info, badge top-right, price bottom-left, button bottom-right):
  | Operator | Rating | Vehicle | Capacity | Price | Badge (tone) |
  |---|---|---|---|---|---|
  | "Raj Transport" ✓ | "4.8 (124 trips)" | "Tata 407" | "2,000 kg available" | "₹4,850" | "Best Price" (success) |
  | "Sree Travels" ✓ | "4.9 (208 trips)" | "Eicher Pro" | "1,500 kg available" | "₹5,200" | "Top Rated" (info) |
  | "Kavin Logistics" ✓ | "4.7 (89 trips)" | "Ashok Leyland" | "3,000 kg available" | "₹5,450" | "More Capacity" (violet) |
  - Button sm primary "View & Select →" → `/customer/booking/[vehicleId]`
**States** — loading skeleton ×3; empty "No vehicles on this route yet" + "Change search"; missing search params → redirect to dashboard.
**Layout** — Desktop: list max 880, image 160×120; optional sort control "Sort: Best price". Mobile: image 88×72, button full-width under price.

## 08 Route & booking details — `/customer/booking/[vehicleId]`
- `PageHeader` "Route & Booking Details"
- `VehicleSummaryCard`: thumb, "Raj Transport", ★ "4.8", "Tata 407 | TN 37 XX 4587"
- `RouteMap` (inline SVG): green origin pin label "Coimbatore", red destination pin label "Chennai", winding dark-green route; caption chip "Illustrative route" (required)
- `RouteStats`: `Route` "498 km" · `Clock` "~ 9 hr" · `MapPin` "3 Stops"
- "**Route:** Coimbatore → Salem → Vellore → Chennai"
- Primary full-width "Book This Vehicle →" → creates draft booking → `/customer/payment?booking=…`
**Layout** — Desktop: map (7 col, aspect 16:10) + right column (vehicle card, stats, route, price summary "Estimated total ₹4,850", CTA). Mobile: stacked, sticky bottom CTA.
Note "3 Stops" vs route list showing 2 intermediate stops (Salem, Vellore) — count stops as segments? `[fix]` lead/P3: label "2 stops" or define "stops" incl. destination.

## 09 Payment — `/customer/payment`
- `PageHeader` "Payment"
- `BookingSummary` title "Booking Summary": "Transportation Charge" "₹4,500"; "TAKI Service Fee" "₹350"; divider; **"Total Payable" "₹4,850"** (amount-lg, price colour)
- `PaymentMethodSelector` title "Choose Payment Method": "UPI (GPay, PhonePe, Paytm)" (selected), "Credit / Debit Card", "Net Banking"
- Primary "Pay ₹4,850 →"
- `[demo]` `DemoBanner` in card: "Demo payment — no money moves."
**States** — processing (button "Processing payment…", disabled, idempotent); failed (inline alert "Payment failed. No money was taken. Try again." + retry); already confirmed → redirect confirmation.
**Layout** — Desktop: two columns (methods 7 / summary 5 sticky). Mobile: summary first, sticky Pay bar.

## 10 Track shipment — `/customer/tracking/[bookingId]`
- `PageHeader` "Track Shipment"
- `BookingIdCopy` "Booking ID: TAKI874523" + `Copy`
- Truck disc (mint, `Truck`) top-right
- `StatusTimeline`:
  1. "Booking Confirmed" — "20 Nov, 09:12 AM" (done)
  2. "Picked Up" — "20 Nov, 11:30 AM" (done)
  3. "In Transit" — "On the way to Chennai" (current, bold)
  4. "Out for Delivery" — "Expected: 20 Nov, 07:00 PM" (upcoming)
  5. "Delivered" (upcoming)
- Primary "View Live Route" `[demo]` → "View Route" (opens `RouteMap` modal/section captioned "Illustrative route — not live GPS")
**Layout** — Desktop: timeline card left (7) + route/vehicle/driver summary right (5). Mobile: stacked.

## 11 Driver dashboard — `/driver/dashboard`
`DashboardShell` driver nav: "Dashboard" (active), "My Routes", "Booking Requests", "Earnings", "Profile", "Help".
- "Hi, Ravi 👋"; sub "Your journey, your earnings."
- `EarningsHeroCard`: "Total Earnings (This Month)", "₹28,500", "▲ +12% vs last month", decorative sparkline
- `StatCard` ×4: "Active Routes" `[fix]` (board "Active Rıtes Routes") "03"; "Booking Requests" "05"; "Completed Trips" "18"; "Available Capacity" "2,000 kg"
- Primary full-width "+ Post a New Route" → `/driver/routes/new`
**Layout** — Desktop: earnings card + stats in 4-col row; ≥1280 add "Pending requests" preview list (2 newest `BookingRequestCard` compact). Tablet 4-col; mobile 2×2 stats.

## 12 Add new route — `/driver/routes/new`
- `PageHeader` "Add New Route"
- "From" `MapPin` "Coimbatore, Tamil Nadu"; "To" `MapPin` "Chennai, Tamil Nadu" (board: label left of field on desktop — use stacked labels on mobile)
- "Intermediate Stops (optional)" — chips "Salem ×", "Vellore ×", add-chip "+ Add Stop" (opens inline input)
- "Travel Date" `Calendar` "20 Nov, 2025" `[fix]` (board "2/Nov, 2025"); "Departure Time" select "08:00 AM"
- "Vehicle Type" select "Tata 407 (Light Truck)"
- "Total Capacity" "3,000 kg"; "Available Capacity" "2,000 kg"
- Primary "Next: Set Pricing →" (saves draft) → `/driver/routes/new/pricing`
**Validation** — available ≤ total; from ≠ to; max 5 stops; duplicates rejected.
Show step indicator "Step 1 of 2" (not on board, recommended).

## 13 Set pricing — `/driver/routes/new/pricing`
- `PageHeader` "Set Pricing"; sub "Enter your rates for this route"
- "Per Kilometre Rate" `₹` "12" "/ km"; "Per Kilogram Rate" `₹` "0.50" "/ kg"
- `PricePreview` (cream panel) "Price Preview (example)" / "For 500 kg (≈ 498 km)" `[fix]` (board "≈ 468 km")
  - "Distance charge (498 km × ₹12)" "₹5,976" `[fix]` (board "488 km"; 498×12 = 5,976)
  - "Weight charge (500 kg × ₹0.50)" "₹250"
  - highlighted row "Your Earnings (before TAKI fee)" "₹6,226"
- Info note `Info`: "The customer will see a final price with a small TAKI service fee added."
- Primary "Publish Route →" → toast "Route published" → `/driver/routes`
**Layout** — Desktop: rates left, preview right (sticky). Preview recomputes live (`aria-live="polite"`).

## 14 Booking requests — `/driver/bookings`
- `PageHeader` "Booking Requests (2)"
- `BookingRequestCard` ×2 (icon disc `Package`; route title; meta; customer; earnings box right; actions):
  1. "Coimbatore → Chennai" · "300 kg | 20 Nov, 2025" · "Customer: Arjun K." · "Your Earnings" "₹6,226"
  2. "Salem → Chennai" · "1,000 kg | 20 Nov, 2025" · "Customer: Meera S." · "Your Earnings" "₹6,976"
  - Buttons: primary "Accept", outline "Decline" (Decline → `ConfirmDialog` "Decline this request?")
**States** — accepted (badge "Accepted", buttons replaced by "View booking"), declined (muted, badge "Declined"), empty "No new booking requests". Add tabs "Pending / Accepted / Declined" (recommended).

## 15 Earnings — `/driver/earnings`
- `PageHeader` "Earnings"
- `PayoutCard`: "Available for Payout" "₹28,500" + lime "Withdraw" `[demo]` → ConfirmDialog "Request payout (demo) — no money moves"
- `EarningsBreakdown`: "This Month" "₹28,500"; "Last Month" "₹25,400"; **"Total Earnings" "₹1,86,200"** (en-IN grouping)
- "Recent Settlements": `SettlementRow` "TAKI874523" · "Coimbatore → Chennai" · "₹6,226" · badge "Paid" (board shows "TAKI874S23" — OCR noise; use "TAKI874523")
**Layout** — Desktop: payout + breakdown side-by-side, settlements table below (columns: Booking ID, Route, Date, Amount, Status). Mobile: stacked list rows.

---
## Extra pages (no board reference — same visual language)

### Login — `/auth/login`
`AuthLayout`; H1 "Welcome back"; sub "Log in to continue with TAKI"; `PhoneInput` "Mobile number"; `PasswordInput` "Password"; primary "Log In"; link "New to TAKI? Create an account" → `/signup`; `DemoBanner` "Demo accounts" with buttons "Fill demo customer" / "Fill demo driver". Errors: "Mobile number or password is incorrect".

### Booking confirmation — `/customer/booking-confirmation?booking=`
Centred card: large `CircleCheck` in mint disc; H1 "Booking Confirmed"; "Booking ID: TAKI874523" + copy; summary rows (Route, Vehicle "Raj Transport · Tata 407", Pickup "20 Nov, 2025", Weight "500 kg", "Amount paid" "₹4,850", "Payment reference" `DEMO-xxxxxx`); demo note "Demo payment — no money moves."; buttons primary "Track Shipment →", outline "Back to Home".

### Customer · My Shipments — `/customer/shipments`
`PageHeader` "My Shipments"; filter tabs "Active / Completed / All"; list rows/cards: route "Coimbatore → Chennai", booking ID, date, weight, status `Badge` (Confirmed=info, In Transit=success, Delivered=neutral, Pending payment=warning, Cancelled=neutral), action "Track" / "Pay now". Empty: "No shipments yet" + "Find Available Vehicles". Desktop table ≥1024, cards below.

### Customer · Payments — `/customer/payments`
`PageHeader` "Payments"; summary strip "Total paid" amount; list: date, booking ID, route, method (UPI/Card/Net Banking), amount, badge "Paid"/"Failed"; each row "Demo" tag. Empty: "No payments yet".

### Customer · Profile — `/customer/profile`
`PageHeader` "Profile"; Avatar + name + "+91 98765 43210" (read-only, `Lock` hint "Verified via OTP"); form: "Full name", "Email (optional)", "Default pickup city"; primary "Save changes"; danger-ghost "Log out".

### Driver · My Routes — `/driver/routes`
`PageHeader` "My Routes" + action "+ Post a New Route"; route cards: "Coimbatore → Chennai", stops chips, "20 Nov, 2025 · 08:00 AM", vehicle "Tata 407 (Light Truck)", capacity bar "2,000 of 3,000 kg available", rates "₹12/km · ₹0.50/kg", status badge "Published"/"Draft"/"Completed"; overflow actions "Edit", "Unpublish". Empty: "You haven't posted any routes yet".

### Driver · Profile — `/driver/profile`
As customer profile + "Vehicle details": "Vehicle type", "Registration number" (e.g. "TN 37 XX 4587"), "Total capacity (kg)"; "Payout account" placeholder (demo; never collect real bank data — show "Coming soon").

### Driver · Help — `/driver/help`
`PageHeader` "Help"; FAQ accordion (`<details>`): "How do I post a route?", "How is my price calculated?", "When do I get paid?", "What happens if I decline a request?"; contact card (`Mail`, `Phone` placeholders, "Support hours"); demo note.

### Landing extras (`/` sections)
- **Benefits** `#benefits`: title "Why TAKI"; 3–6 tiles using brand-element icons — "Save on shipping" (pay only for the space you use), "Earn on every trip" (fill spare capacity), "Verified operators" (`ShieldCheck` — describe as "Profile and vehicle checks" only if P3/lead confirm such checks exist; else "Rated by customers"), "Greener roads" (`Leaf`, fewer empty trips). Optional cargo tiles row using `cargo/*.webp` ("Agriculture produce", "Construction material", "General goods", "Industrial goods").
- **About** `#about`: 2-col (text + `hero/hero_freight_highway_unbranded.webp` r-xl image); short mission paragraph; no fabricated stats (no "10,000+ trucks").
- **Contact** `#contact`: card with `Mail`/`Phone`/`MapPin` placeholders + simple form ("Name", "Mobile or email", "Message", "Send message" → demo toast "Thanks — this demo doesn't send messages").
- **Footer** (green-950 bg): Logo(dark), nav links, "© 2025 TAKI Travel", "Images are illustrative" note.

---
## Cross-screen notes
- Every page: one `h1` (dashboard greeting or page title — PageHeader renders h1 on inner pages; spec "h2" size is visual only).
- Back arrows use real links (`href`), not `history.back()` only.
- All amounts via `formatINR`, dates `formatDate`; arrows in routes rendered with sr-only "to".
- Data inconsistencies to resolve (lead/P3): customer pays ₹4,850 (incl. ₹350 fee) for 500 kg while the driver's earnings for the same booking TAKI874523 are ₹6,226 (and request #1 is 300 kg with the same ₹6,226). Booking request #2 ₹6,976 does not follow ₹12/km + ₹0.50/kg for Salem→Chennai. UI must render domain-calculated values, not board numbers.
