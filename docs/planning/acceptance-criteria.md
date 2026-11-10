# Acceptance Criteria — TAKI Travel (P4)

Each criterion is testable and maps to a spec in `test-strategy.md` §10. "Verbatim" = exact string from
the crop (case, punctuation, `→`, `₹`). Seed data reproduces the crop values. Global criteria (G-*)
apply to every page and are not repeated.

## G. Global (all routes)

- G-1 Every route listed in `test-strategy.md` §2 returns 200 on `next start -p 3100`; unknown paths render a branded not-found page with a link home.
- G-2 One `h1` per page; `<title>` = "{Page} · TAKI Travel"; `<html lang="en-IN">`.
- G-3 Skip link "Skip to main content" is the first Tab stop and moves focus to `main#main`.
- G-4 No horizontal overflow at 1440, 1280, 768, 390, 360 widths (`scrollWidth <= innerWidth`).
- G-5 All interactive targets ≥ 24×24 CSS px; primary CTAs ≥ 44px tall.
- G-6 Visible focus indicator on every focusable element; Tab order follows visual order.
- G-7 axe: zero serious/critical violations (wcag2a/aa, 21aa, 22aa) in default, error and drawer-open states.
- G-8 No console errors, page errors, hydration warnings or failed same-origin requests.
- G-9 Money formatted en-IN with `₹` and no decimals unless non-integer rate (`₹0.50`); dates "20 Nov, 2025"; weights "2,000 kg".
- G-10 Brand tokens used: `#173D32`, `#286B50`, `#83B99A`, `#F5F5EF`, `#242B29`; Montserrat headings, Inter body. White text is never placed on `#83B99A`; `#83B99A` is never used as text colour.
- G-11 `prefers-reduced-motion: reduce` disables non-essential animation.
- G-12 Logo = pin symbol + "TAKI / TRAVEL" Montserrat wordmark; links to `/` (public) or role dashboard (app shell); has accessible name "TAKI Travel home".
- G-13 Demo mode is visibly indicated in the app shell (e.g. "Demo" badge) and in auth/payment/tracking where noted below.

## N. Navigation shells

- N-1 Public header (`/`): How it Works → `#how-it-works`, Benefits → `#benefits`, About → `#about`, Contact → `#contact` (sections exist), Login → `/auth/login`.
- N-2 Customer sidebar items verbatim and in order: Home → `/customer/dashboard`, My Shipments → `/customer/shipments`, Payments → `/customer/payments`, Profile → `/customer/profile`.
- N-3 Driver sidebar items verbatim and in order: Dashboard → `/driver/dashboard`, My Routes → `/driver/routes`, Booking Requests → `/driver/bookings`, Earnings → `/driver/earnings`, Profile → `/driver/profile`, Help → `/driver/help`.
- N-4 Active item shows the pale-lime pill with dark-green text and `aria-current="page"`; nested routes (e.g. `/driver/routes/new`) highlight their parent.
- N-5 Sidebar is dark green (`#173D32` family) with logo at top on ≥ 1024px; below 1024px a top bar with menu button replaces it.
- N-6 Drawer: button has `aria-expanded`, `aria-controls`; opening moves focus into drawer; Tab is trapped; Esc and backdrop click close; focus returns to button; closes on navigation.
- N-7 Bell icon button has accessible name "Notifications"; avatar button has name "Account menu" (or links to profile).
- N-8 Every back arrow (`←`) has accessible name and goes to the previous step in the flow (listed per page), not `history.back()` into another site.
- N-9 Customer session visiting `/driver/*` (and vice versa) is redirected to its own dashboard; unauthenticated visit to any `/customer/*` or `/driver/*` redirects to `/auth/login?next={path}`.

## L. Landing `/` (crop 01)

- L-1 Hero uses `login_truck_mountain_photo.webp` with left dark-green gradient; headline legible (contrast per test-strategy §6).
- L-2 Verbatim: badge "Smart Logistics Marketplace"; h1 "Your goods. Their route. One smart connection."; sub "Find available vehicles travelling your way." / "Ship your goods without booking an entire truck."
- L-3 "Ship Goods →" (pale-lime filled) → `/signup?role=customer`; "List a Route" (outlined) → `/signup?role=driver`.
- L-4 "How TAKI Works" card with three steps in order: "Find a Route" / "Search for vehicles on your route."; "Choose a Vehicle" / "Compare, check details and book."; "Ship with Ease" / "Pay online and track in real time." with arrows between; stacks vertically < 768px.
- L-5 "track in real time" claim is qualified or footnoted as demo/illustrative in demo mode (see open question Q3).
- L-6 Hero image is `priority`/eagerly loaded with width/height set; LCP image not lazy.

## A. Auth & signup (crops 02–05)

Shared: centred white card on `#F5F5EF`, logo top centre, green wave footer, back arrow top-left on 03–05.

- A-1 `/signup` verbatim: "Join TAKI Travel", "Choose how you want to use TAKI", "I'm a Customer" / "I want to ship goods", "I'm a Lorry Driver" / "I want to list my route and earn".
- A-2 Role options are keyboard-operable (links or radio group); selected/hover option shows green border as on crop 02; `?role=` pre-selects; selecting continues to `/auth/phone` with role stored.
- A-3 `/auth/phone` verbatim: "Enter your mobile number", "+91" prefix with India flag (flag `alt=""`, prefix announced), placeholder "Enter mobile number", button "Send OTP". Sub-text adjusted for demo (Q2).
- A-4 Input: `type="tel"`, `inputmode="numeric"`, `autocomplete="tel-national"`, `maxLength=10`, accessible label "Mobile number".
- A-5 Errors: empty → "Enter your mobile number"; not 10 digits → "Enter a valid 10-digit mobile number"; first digit 0–5 → "Mobile number must start with 6, 7, 8 or 9"; letters cannot be entered or produce the 10-digit error. Errors are linked via `aria-describedby`; `aria-invalid="true"`.
- A-6 Send OTP shows loading state and navigates to `/auth/verify-otp` only when valid.
- A-7 `/auth/verify-otp` verbatim: "Verify OTP", "Enter the 6-digit code sent to", number formatted "+91 98765 43210", button "Verify", "Resend OTP in 00:24" style countdown (mm:ss, bold time).
- A-8 Six single-digit inputs in a `fieldset` with legend; each labelled "Digit N of 6"; auto-advance on input, Backspace moves back, paste of 6 digits fills all, arrow keys move between boxes; non-digits rejected.
- A-9 Demo panel shows the generated code with text "Demo mode: no SMS is sent. Your code is NNNNNN." The code is random per request; a fixed code (e.g. `123456`) is rejected unless it happens to be the generated one.
- A-10 Incomplete → Verify disabled or "Enter all 6 digits"; wrong → "Incorrect code" + attempts remaining, inputs cleared, focus on Digit 1; after 5 wrong attempts → locked until resend; code older than 5 min → "Code expired. Request a new one."
- A-11 Resend is disabled during 30s cooldown, then becomes a button "Resend OTP"; resending issues a new code and invalidates the old; countdown is not announced every second (one polite announcement when available).
- A-12 Direct visit to `/auth/verify-otp` or `/auth/create-password` without prior step state redirects to `/auth/phone`.
- A-13 `/auth/create-password` verbatim: "Create a Password", "Set a password to secure your account.", placeholders "Enter password" / "Confirm password", rules "At least 8 characters", "One uppercase letter", "One number", button "Create Account". Fields have visible or `aria-label` labels "Password" / "Confirm password".
- A-14 Rule list updates live; each rule exposes met/unmet in text (not icon colour only); `autocomplete="new-password"`.
- A-15 Eye toggles: named "Show password"/"Hide password", toggle input type, do not submit form.
- A-16 Mismatch → "Passwords do not match"; Create Account blocked until all rules + match; success → role dashboard (`/customer/dashboard` or `/driver/dashboard`) or safe `next`.
- A-17 `/auth/login`: phone + password (and "Login with OTP" link → `/auth/phone`), link "New to TAKI? Join" → `/signup`; same card style as 03/05; demo credential handling identical (no hardcoded universal password).
- A-18 `?next=` accepted only if it starts with `/`, not `//` or `/\`, contains no scheme, and is inside the signed-in role's prefix; otherwise role dashboard. A customer with `?next=/driver/earnings` lands on `/customer/dashboard`. `/auth/login?next=//evil.com` and `?next=https://evil.com` land on the dashboard.
- A-19 Passwords are never stored in plain text in localStorage (demo stores only a flag/hash) and never logged.

## C. Customer journey (crops 06–10)

### Dashboard `/customer/dashboard` (06)
- C-1 Verbatim: "Hi, Arjun 👋" (name from profile; emoji `aria-hidden`), "Where are we shipping today?", card "New Shipment", labels "Source", "Destination", "Cargo Weight", "Pickup Date", button "Find Available Vehicles →".
- C-2 Source/Destination inputs show map-pin icon; suggestions list (combobox with `aria-expanded`, arrow-key navigation) from seeded Indian cities; values like "Coimbatore, Tamil Nadu".
- C-3 Weight: numeric input + unit select ("kg" default; optional "tonnes" converts to kg); Pickup Date: date input with calendar icon, displays "20 Nov, 2025" format.
- C-4 Validation per test-strategy §7 (required, same source/destination, weight > 0 and ≤ 40,000 kg, date ≥ today IST).
- C-5 Submit saves shipment draft to store and navigates to `/customer/vehicles`.

### Available vehicles `/customer/vehicles` (07)
- C-6 Header "Available Vehicles (N)" where N = rendered count; summary row "Coimbatore → Chennai | 500 kg | 20 Nov, 2025"; back → dashboard (draft kept).
- C-7 Seed shows exactly: Raj Transport ★ 4.8 (124 trips), Tata 407 | 2,000 kg available, ₹4,850, badge "Best Price"; Sree Travels ★ 4.9 (208 trips), Eicher Pro | 1,500 kg available, ₹5,200, "Top Rated"; Kavin Logistics ★ 4.7 (89 trips), Ashok Leyland | 3,000 kg available, ₹5,450, "More Capacity" (lavender).
- C-8 Each card: truck thumbnail (meaningful `alt`, e.g. "Raj Transport Tata 407 truck"), verified tick with accessible text "Verified (demo)", rating as text ("Rated 4.8 out of 5, 124 trips"), button "View & Select →" with name including operator.
- C-9 Only vehicles with available capacity ≥ cargo weight and matching route/date are listed; zero results shows empty state with "Edit shipment" CTA.
- C-10 "View & Select" → `/customer/booking/{vehicleId}`.
- C-11 Direct visit without draft → redirect to `/customer/dashboard` with message "Start by entering your shipment details."

### Route & Booking details `/customer/booking/[vehicleId]` (08)
- C-12 Verbatim: "Route & Booking Details"; operator card "Raj Transport ★ 4.8", "Tata 407 | TN 37 XX 4587"; stats "498 km", "~ 9 hr", "3 Stops"; "Route: Coimbatore → Salem → Vellore → Chennai"; button "Book This Vehicle →".
- C-13 Map is a static illustration with origin (green) and destination (red) pins labelled; caption "Illustrative route map" visible; image has `alt` describing the route.
- C-14 Unknown `vehicleId` → not-found; no draft → redirect dashboard; back → `/customer/vehicles`.
- C-15 "Book This Vehicle" stores selection and → `/customer/payment`.

### Payment `/customer/payment` (09)
- C-16 Verbatim: "Payment", "Booking Summary", "Transportation Charge ₹4,500", "TAKI Service Fee ₹350", "Total Payable ₹4,850"; "Choose Payment Method": "UPI (GPay, PhonePe, Paytm)", "Credit / Debit Card", "Net Banking"; button "Pay ₹4,850 →".
- C-17 Total = transportation + fee computed by `pricing.ts` (not hardcoded); Pay label matches total.
- C-18 Payment methods are a native radio group with legend; UPI selected by default; selection visible by filled radio and border.
- C-19 Demo notice adjacent to Pay: "Demo payment — no money will be charged." No card number/CVV/UPI PIN fields exist anywhere.
- C-20 Pay click: button disables immediately, shows "Processing…", `aria-busy`; exactly one booking is created even on double-click, Enter-repeat or back-and-retry (idempotency key = draft id).
- C-21 Success → `/customer/booking-confirmation?id={bookingId}`; draft cleared; booking ID format `TAKI` + 6 digits (seed "TAKI874523").
- C-22 No draft/selection → redirect to dashboard.

### Booking confirmation `/customer/booking-confirmation`
- C-23 Shows success icon, "Booking Confirmed", booking ID with copy button (announces "Copied" via live region), route, vehicle, pickup date, amount paid "₹4,850 (demo)".
- C-24 CTAs: "Track Shipment" → `/customer/tracking/{bookingId}`; "Go to Dashboard" → `/customer/dashboard`. Missing/unknown id → redirect `/customer/shipments`.

### Track shipment `/customer/tracking/[bookingId]` (10)
- C-25 Verbatim: "Track Shipment", "Booking ID: TAKI874523" with copy icon; timeline "Booking Confirmed 20 Nov, 09:12 AM", "Picked Up 20 Nov, 11:30 AM", "In Transit On the way to Chennai", "Out for Delivery Expected: 20 Nov, 07:00 PM", "Delivered"; truck illustration in pale-green circle.
- C-26 Timeline is an ordered list; each step exposes status in text (completed/current/upcoming); completed = green tick, upcoming = grey chevron.
- C-27 "View Live Route" button is relabelled or captioned to make clear it opens an illustrative route (e.g. "View Route (illustrative)"); never claims live GPS.
- C-28 Unknown bookingId or booking owned by another demo user → not-found.

### Other customer pages
- C-29 `/customer/shipments`: list of bookings (route, date, weight, status chip, amount) newest first; each links to tracking; empty state "No shipments yet" + "Ship Goods" → dashboard.
- C-30 `/customer/payments`: list of demo payments (booking ID, date, method, amount, "Paid (demo)"); totals use en-IN; empty state.
- C-31 `/customer/profile`: name, +91 phone (masked except last 4 optional), role; "Log out" clears session (not seed data) → `/`; "Reset demo data" with confirm dialog (focus-trapped, Esc closes).

## D. Driver journey (crops 11–15)

### Dashboard `/driver/dashboard` (11)
- D-1 Verbatim: "Hi, Ravi 👋", "Your journey, your earnings."; card "Total Earnings (This Month)" "₹28,500" "▲ +12% vs last month" with decorative sparkline (`aria-hidden`); tiles "Active Routes 03", "Booking Requests 05", "Completed Trips 18", "Available Capacity 2,000 kg"; button "+ Post a New Route".
- D-2 Tile values derive from store (counts consistent with `/driver/routes` and `/driver/bookings`); tiles link to their pages.
- D-3 Earnings card dark green with white text (contrast ≥ 4.5:1); trend not conveyed by colour alone.
- D-4 "Post a New Route" → `/driver/routes/new`.

### Add new route `/driver/routes/new` (12)
- D-5 Verbatim: "Add New Route", "From", "To", "Intermediate Stops (optional)", chips "Salem ×", "Vellore ×", "+ Add Stop", "Travel Date", "Departure Time", "Vehicle Type", "Tata 407 (Light Truck)", "Total Capacity", "Available Capacity", button "Next: Set Pricing →".
- D-6 Stop chips: remove button named "Remove Salem"; Add Stop opens an input; max 5 stops; duplicates rejected.
- D-7 Validation: required fields; from ≠ to; stop ≠ from/to; date ≥ today; available ≤ total; capacities > 0 and numeric; total ≤ vehicle type max.
- D-8 Valid submit saves route draft → `/driver/routes/new/pricing`; back → `/driver/dashboard` (draft retained).

### Set pricing `/driver/routes/new/pricing` (13)
- D-9 Verbatim: "Set Pricing", "Enter your rates for this route", "Per Kilometre Rate" (₹ … / km), "Per Kilogram Rate" (₹ … / kg), "Price Preview (example)", "Distance charge", "Weight charge", "Your Earnings (before TAKI fee)", info "The customer will see a final price with a small TAKI service fee added.", button "Publish Route →".
- D-10 Preview recalculates live: with 12 and 0.50 for 500 kg over 498 km → Distance ₹5,976, Weight ₹250, Earnings ₹6,226 (distance text must match the computed km; see Q1). Preview region `aria-live="polite"` (debounced).
- D-11 Rates must be numeric > 0 (≤ ₹200/km, ≤ ₹50/kg); invalid → field error, Publish disabled, preview shows "—".
- D-12 No route draft → redirect to `/driver/routes/new`.
- D-13 Publish (idempotent) creates one route → `/driver/routes` with success toast "Route published" (live region); Active Routes count +1.

### Routes `/driver/routes`
- D-14 Lists routes (from → to, date, time, vehicle, available/total capacity, rates, status); "Post a New Route" CTA; empty state.

### Booking requests `/driver/bookings` (14)
- D-15 Verbatim: "Booking Requests (N)" with N = pending count; cards "Coimbatore → Chennai", "300 kg | 20 Nov, 2025", "Customer: Arjun K.", "Your Earnings ₹6,226"; "Salem → Chennai", "1,000 kg | 20 Nov, 2025", "Customer: Meera S.", "₹6,976"; buttons "Accept" (filled) / "Decline" (outlined).
- D-16 Buttons have names including the route ("Accept Coimbatore → Chennai request").
- D-17 Accept: disables both buttons, reduces route available capacity by weight, moves card to Accepted, header count −1, toast; second click or second tab cannot accept again.
- D-18 Accept with weight > remaining capacity is blocked with "Not enough capacity on this route".
- D-19 Decline asks for confirmation (dialog, focus-trapped, Esc cancels); declined is terminal; capacity unchanged.
- D-20 Empty state "No pending requests" when N = 0.

### Earnings `/driver/earnings` (15)
- D-21 Verbatim: "Earnings", "Available for Payout ₹28,500", button "Withdraw", rows "This Month ₹28,500", "Last Month ₹25,400", "Total Earnings ₹1,86,200", "Recent Settlements": "TAKI874523 Coimbatore → Chennai ₹6,226 Paid".
- D-22 Withdraw opens a demo dialog ("Demo mode — no payout is made") and never collects bank account numbers; focus-trapped, Esc closes.
- D-23 "Paid" chip text contrast ≥ 4.5:1.

### Other driver pages
- D-24 `/driver/profile`: name, phone, vehicle(s), Log out, Reset demo data (as C-31).
- D-25 `/driver/help`: FAQ (accordion with `button[aria-expanded]`) and contact info; external links have `rel="noopener noreferrer"`.

## S. Security & integrity acceptance

- S-1 Demo OTP random per request; no constant accepted; live mode without provider config fails closed with a clear error.
- S-2 `.next/static` contains no secret-like strings; client code reads only `NEXT_PUBLIC_*` env vars; no `.env*` with secrets committed.
- S-3 No card PAN/CVV/UPI PIN/bank account inputs; localStorage contains no 13–19 digit numbers or password plaintext.
- S-4 Every payment/payout surface labelled demo; no "transaction successful" bank wording.
- S-5 README and code comments state client-side guards and localStorage are demo-only; production needs server auth and a database.
- S-6 Store key namespaced + versioned; corrupt or old-version data resets safely without crash.
- S-7 Booking creation, route publishing and request acceptance are idempotent (unit + e2e).
- S-8 `safeRedirect` passes the unit table in `test-strategy.md` §9.
- S-9 No `dangerouslySetInnerHTML`/`innerHTML`/`eval` with dynamic data (grep clean).
- S-10 Tracking map and route maps labelled illustrative; vehicle photos not claimed as real fleet.
- S-11 Responses include `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame-ancestors protection.
- S-12 Cashfree stub routes return 501 when unconfigured; no Cashfree secret appears in client bundle; webhook rejects unsigned/invalid-signature requests; server derives amount from the booking, never from the request body.

## R. Release gates

- R-1 `npm run build` succeeds with no type or lint errors; `tsc --noEmit` strict passes; `npm run lint` 0 errors.
- R-2 `npm run test` (Vitest) passes; `src/lib/**` line coverage ≥ 90%.
- R-3 `npm run test:e2e` passes all specs: customer-journey, driver-journey, auth-validation, navigation-links, responsive, a11y, visual, integrity.
- R-4 axe: 0 serious/critical across all routes and states.
- R-5 Security check script passes (S-1…S-12).
- R-6 Zero open P0 and P1 defects (definitions in `test-strategy.md` §11); open P2s explicitly accepted by lead.
- R-7 Visual screenshots for all 15 cropped screens reviewed side-by-side and signed off; uncropped pages reviewed for shell consistency.
- R-8 No console errors in any e2e run.
