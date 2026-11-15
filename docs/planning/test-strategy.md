# Test Strategy — TAKI Travel (P4: QA, Security & Delivery)

Status: Phase 1 plan. Pairs with `acceptance-criteria.md` (numbered AC-IDs referenced below).
Sources: `00-lead-brief.md`, `Reference.jpeg`, `references/screens/01..15-*.png`.

## 1. Scope and tooling

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Static | `tsc --noEmit` (strict), ESLint (next + jsx-a11y), `next build` | — | every PR / gate |
| Unit | Vitest (+ @testing-library/react for components with logic) | `tests/unit/**/*.test.ts` (node env; `// @vitest-environment jsdom` per file when DOM needed) | `npm run test` |
| E2E | Playwright, chromium projects `desktop` 1440×900, `laptop` 1280×800, `tablet` 768×1024, `mobile` 390×844, `small` 360×800 | `tests/e2e/*.spec.ts` | `npm run test:e2e`; webServer `npm run build && npm run start -- -p 3100`, baseURL `http://localhost:3100` |
| A11y | @axe-core/playwright, tags `wcag2a, wcag2aa, wcag21aa, wcag22aa` | `tests/e2e/a11y.spec.ts` | gate |
| Visual | Playwright screenshots (manual compare vs crops, no pixel-diff gate) | `test-results/visual/` | gate (review) |
| Security | scripted greps over `src/` and `.next/static` | `scripts/security-check.mjs` (proposed) | gate |

Principles: test against the production build (not `next dev`); every e2e test starts from cleared
localStorage (fresh context) unless it is testing persistence. Journeys that are not about auth seed a
signed-in session via `addInitScript` writing the `taki-demo-v1` key (shared fixture `tests/e2e/fixtures.ts`);
the OTP step reads the demo code from `data-testid="demo-otp-code"`;
**clock**: seed dates are relative to T (today, IST), so date-dependent specs call `page.clock.install` *before*
`goto`. Use 2025-11-19T10:00+05:30 for search, vehicles, details, payment and requests, and 2025-11-20T14:00+05:30 for
tracking TAKI874523. The browser clock can't freeze the server, so relative dates must be computed client-side
(no SSR date text), otherwise a hydration mismatch appears (P1). Re-seed test: set storage with `seededOn` = yesterday, then load. User accounts and session must survive;
seed and transactional data are replaced; toast "Demo data refreshed for today — demo bookings were reset"; advancing the clock
past midnight mid-session must NOT re-seed;
use role/label locators (`getByRole`, `getByLabel`) — if a locator cannot be written that
way, that is an a11y defect. Prefer `data-testid` only for non-semantic containers (cards, timeline).

## 2. Page inventory and reference mapping

| # | Route | Crop | Shell | Primary test specs |
|---|---|---|---|---|
| 1 | `/` | 01-landing | public header | navigation, visual, a11y, responsive |
| 2 | `/signup` | 02-role-selection | auth card + wave | customer/driver journey, visual |
| 3 | `/auth/login` | (none — derive from 03/05) | auth card | auth-validation |
| 4 | `/auth/phone` | 03-mobile-number | auth card | auth-validation |
| 5 | `/auth/verify-otp` | 04-verify-otp | auth card | auth-validation |
| 6 | `/auth/create-password` | 05-create-password | auth card | auth-validation |
| 7 | `/customer/dashboard` | 06-customer-dashboard | customer sidebar | customer journey |
| 8 | `/customer/vehicles` | 07-available-vehicles | customer sidebar | customer journey |
| 9 | `/customer/booking/[vehicleId]` | 08-route-booking-details | customer sidebar | customer journey |
| 10 | `/customer/payment` | 09-payment | customer sidebar | customer journey, integrity |
| 11 | `/customer/booking-confirmation` | (none — derive) | customer sidebar | customer journey |
| 12 | `/customer/tracking/[bookingId]` | 10-track-shipment | customer sidebar | customer journey |
| 13 | `/customer/shipments` | (none) | customer sidebar | navigation |
| 14 | `/customer/payments` | (none) | customer sidebar | navigation |
| 15 | `/customer/profile` | (none) | customer sidebar | navigation |
| 16 | `/driver/dashboard` | 11-driver-dashboard | driver sidebar | driver journey |
| 17 | `/driver/routes` | (none) | driver sidebar | driver journey |
| 18 | `/driver/routes/new` | 12-add-new-route | driver sidebar | driver journey, validation |
| 19 | `/driver/routes/new/pricing` | 13-set-pricing | driver sidebar | driver journey, validation |
| 20 | `/driver/bookings` | 14-booking-requests | driver sidebar | driver journey, integrity |
| 21 | `/driver/earnings` | 15-earnings | driver sidebar | driver journey |
| 22 | `/driver/profile` | (none) | driver sidebar | navigation |
| 23 | `/driver/help` | (none) | driver sidebar | navigation |
| — | unknown path, unknown `vehicleId`/`bookingId` | — | not-found | navigation |

Pages with no crop must reuse the established shell, card, typography and button styles of the nearest
cropped sibling (consistency review, not fidelity review).

## 3. Visual-fidelity method

For each cropped screen, capture at 1440×900 full-page and compare side-by-side with the crop. Check in
this order and log findings with severity:
1. **Layout** — column structure, card grouping, order of sections, sidebar width proportion (~22% of the card in crops), alignment of CTA to bottom of card.
2. **Text verbatim** — headings, labels, placeholders, button text, units, ₹ formatting (en-IN: `₹1,86,200`), arrows `→`. Verbatim strings are listed per page in `acceptance-criteria.md`.
3. **Colours** — primary `#173D32` (sidebar, headings), secondary `#286B50` (primary buttons), accent `#83B99A`, bg `#F5F5EF`, text `#242B29`; pale lime active-nav pill; pale green badges/earnings tiles; lavender "More Capacity" badge; green check ticks.
4. **Radii & elevation** — cards ~12–16px radius with soft shadow; inputs ~8px; buttons ~8px (not full pills, except "Smart Logistics Marketplace" badge, "Paid" chip and route-stop chips).
5. **Imagery** — hero = `login_truck_mountain_photo.webp` + left dark-green gradient; vehicle thumbnails from `vehicles/`; map = `ui/route_map_illustration.webp` or SVG, labelled illustrative; wave footer on auth cards; pin logo (approved deviation, see lead decision 1).
6. **Sidebar** — dark green, logo top, active item in pale-lime pill with dark text, icon + label per item.
7. **Icons** — lucide equivalents: home, package, credit-card/wallet, help-circle/user, bell, map-pin, calendar, clock, eye, lock, check, arrow-left, arrow-right, star, badge-check (verified), truck, route.

Visual screenshots: `tests/e2e/visual.spec.ts` saves `test-results/visual/{viewport}/{NN-route-slug}.png` for every
route at 1440×900 and 390×844 using seeded demo state. Reviewers (Phase 3) annotate deviations in the
bug log; no automated pixel threshold because crops are upscaled raster renders.

## 4. Interaction checklist (applies to every interactive element)

| State | Requirement |
|---|---|
| Hover | visible change (bg shade or underline) on buttons, links, cards that are clickable |
| Focus | `:focus-visible` ring ≥ 2px, contrast ≥ 3:1 against adjacent colours; never `outline: none` without replacement |
| Active nav | `aria-current="page"` on current sidebar/header link plus visual pill |
| Disabled | `disabled` attribute (or `aria-disabled` + blocked handler), reduced opacity, not focus-trapping; reason visible nearby where non-obvious |
| Loading | button shows spinner + text change (e.g. "Processing…"), is disabled, `aria-busy="true"`; layout does not jump |
| Empty | lists (shipments, payments, routes, requests, settlements) have an empty state with a CTA |
| Error | inline message under field, `aria-invalid="true"`, `aria-describedby` → message id; summary/alert in `role="alert"` region |

Full per-button destination table: `acceptance-criteria.md` §N (navigation) and per-page sections.
`navigation-links.spec.ts` asserts every `a[href]` in header/sidebar/footer resolves with HTTP 200 and the
target page shows its `h1`.

## 5. Responsive matrix

| Viewport | Device class | Must check |
|---|---|---|
| 1440×900 | desktop | reference layout; sidebar fixed; 2-col forms as in crops |
| 1280×800 | small laptop | no clipping of cards; landing "How TAKI Works" row still single-row |
| 768×1024 | tablet | sidebar collapses to top bar + drawer (hamburger); cards full width; 2-col form rows may stay |
| 390×844 | phone | drawer nav; forms stacked single column; hero text over image readable; CTA full-width; OTP boxes fit one row |
| 360×800 | small phone | same as 390 + OTP 6 boxes fit (≥ 40px each incl. gaps), long ₹ values don't overflow, booking request buttons stack or fit |

Automated per viewport × every route (`responsive.spec.ts`):
- `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal overflow).
- Below 1024px: sidebar `nav` hidden, menu button visible with `aria-expanded`/`aria-controls`; opening it shows the nav, Esc closes it and returns focus to the button.
- All visible `button, a, input, select, [role=button]` have bounding box ≥ 24×24 CSS px (WCAG 2.2 2.5.8); log a warning (P3) if < 44×44 for primary CTAs.
- No text smaller than 12px computed; inputs ≥ 16px font on mobile (prevents iOS zoom).
- Images have explicit dimensions (no CLS > 0.1 in a Lighthouse spot-check of `/` and `/customer/dashboard`).

## 6. Accessibility requirements (WCAG 2.2 AA)

- **Landmarks**: one `header`, one `main#main`, `nav` with `aria-label` ("Primary", "Customer", "Driver"), `footer` on landing. One `h1` per page matching the visible title.
- **Skip link**: first focusable element "Skip to main content" → `#main`, visible on focus.
- **Labels**: every input has a programmatic label (visible label or `aria-label` where the crop shows placeholder-only fields, e.g. mobile number, password fields). Placeholders are never the only label.
- **Focus order**: matches visual order; back arrow (`←`) is a link/button with `aria-label="Back"` (or "Back to …").
- **Drawer/dialog**: focus moves in on open, trapped while open, Esc closes, focus returns to trigger, background `inert` / `aria-hidden`.
- **OTP**: 6 inputs inside `fieldset` + `legend` ("Enter the 6-digit code"); each input `aria-label="Digit N of 6"`, `inputmode="numeric"`, `autocomplete="one-time-code"` on first; paste of 6 digits fills all; Backspace moves back.
- **Live regions**: field errors associated via `aria-describedby`; form-level errors in `role="alert"`; toasts in `aria-live="polite"`; resend countdown must NOT announce every second (announce only when resend becomes available).
- **Icons**: decorative icons `aria-hidden="true"`; icon-only buttons (bell, avatar, eye toggle, remove-stop ×) have accessible names; password eye toggle has `aria-pressed` or name swap "Show password"/"Hide password".
- **Status**: timeline steps convey state in text ("Completed", "Current", "Pending"), not colour/tick only; badges ("Best Price", "Paid") are text.
- **Radio groups**: payment methods are a native radio group with `fieldset/legend` "Choose Payment Method"; role cards on `/signup` are links or radios, not clickable divs.
- **Contrast** (computed from brand tokens):

| Pair | Ratio | Result |
|---|---|---|
| white on `#286B50` (primary button) | ≈ 6.3:1 | pass |
| white on `#173D32` (sidebar) | ≈ 12:1 | pass |
| `#173D32` on `#83B99A` (active pill if accent used) | ≈ 5.3:1 | pass |
| white on `#83B99A` | ≈ 2.2:1 | **FAIL — forbidden** |
| `#83B99A` text on `#F5F5EF`/white | ≈ 2.0:1 | **FAIL — never use accent as text** |
| `#286B50` on `#F5F5EF` | ≈ 5.8:1 | pass |
| pale-green badge text (e.g. "Best Price", "Paid", "Your Earnings") | must measure | require ≥ 4.5:1 — use `#173D32`/`#286B50` text on pale tint |
| grey secondary text ("I want to ship goods", "124 trips") | must measure | ≥ 4.5:1 on its background (grey no lighter than ~`#6B7280` on white) |
| hero headline over photo | measure on gradient | ≥ 4.5:1 for body, ≥ 3:1 for ≥ 24px headline at darkest/brightest sampled point |

- **Motion**: all transitions/animations wrapped so `prefers-reduced-motion: reduce` disables non-essential motion (route-line animation, card transitions). Playwright: `page.emulateMedia({ reducedMotion: 'reduce' })` smoke.
- **Zoom/reflow**: 200% zoom at 1280 and 320 CSS px width reflow without loss (covered by 360 viewport).
- **Lang**: `<html lang="en-IN">`; page `<title>` unique per route ("Payment · TAKI Travel").

## 7. Invalid-state test matrix (unit for schemas + e2e for UX)

| Form | Case | Expected |
|---|---|---|
| Phone | empty | "Enter your mobile number"; Send OTP does not navigate |
| Phone | < 10 digits / > 10 digits | "Enter a valid 10-digit mobile number"; input `maxLength=10` |
| Phone | letters / symbols | non-digits stripped or rejected; error shown |
| Phone | starts with 0–5 | "Mobile number must start with 6, 7, 8 or 9" |
| OTP | < 6 digits | Verify disabled or error "Enter all 6 digits" |
| OTP | wrong code | "Incorrect code. N attempts left"; inputs cleared, focus to digit 1 |
| OTP | expired (> 5 min, use fake timers / clock) | "Code expired. Request a new one" |
| OTP | resend during cooldown | Resend disabled, shows "Resend OTP in 00:SS"; enabled at 00:00; new code invalidates old |
| OTP | max attempts (5) | locked; must resend |
| OTP | direct visit without phone in state | redirect to `/auth/phone` |
| Password | < 8 chars / no uppercase / no number | matching rule row shows unmet (icon + text), Create Account disabled or errors |
| Password | mismatch | "Passwords do not match" on confirm field |
| Shipment | missing source/destination/weight/date | per-field required errors |
| Shipment | source == destination (case/whitespace-insensitive) | "Source and destination must be different" |
| Shipment | weight ≤ 0, non-numeric, > platform max (e.g. 40,000 kg) | numeric range errors |
| Shipment | weight > every vehicle's available capacity | vehicles page shows empty state "No vehicles with enough capacity", not a broken list |
| Shipment | pickup date in past | "Pickup date can't be in the past" (today allowed; compare in IST) |
| Vehicles | vehicle with available < weight | hidden or "View & Select" disabled with reason |
| Route | from == to; duplicate intermediate stop; stop equals from/to | errors |
| Route | available > total; negative/zero capacity; non-numeric | errors |
| Route | missing date/time/vehicle type; past date | errors |
| Pricing | ≤ 0, negative, non-numeric, > sane max (e.g. ₹200/km, ₹50/kg) | errors; preview hides or shows "—" |
| Pricing | direct visit without route draft | redirect to `/driver/routes/new` |
| Booking | `/customer/vehicles`, `/customer/booking/*`, `/customer/payment` with no shipment draft | redirect to `/customer/dashboard` with notice |
| Booking | unknown `vehicleId` / `bookingId` | not-found UI (404), no crash |
| Payment | no method selected (if no default) | Pay disabled / error |
| Payment | double-click / rapid Enter on Pay | exactly one booking created (assert store length), one confirmation |
| Payment | browser back after confirmation then Pay again | no duplicate; payment page redirects to existing confirmation (status ∉ pending_payment/payment_failed) |
| Payment | "Simulate payment failure" checked | `payment_failed`, alert, retry allowed; success after retry → one booking, one succeeded payment; checkbox absent in live mode |
| Driver requests | accept twice (double-click, two tabs) | one acceptance; second click no-op |
| Driver requests | accept Arjun 300 + Meera 1,000 on r1 (2,000) → Karthik 1,200 | Karthik Accept disabled with "Not enough capacity — 700 kg left, needs 1,200 kg"; Decline enabled |
| Driver requests | decline then accept | not possible (terminal state) unless "Undo" designed explicitly |

## 8. Security and integrity

| Risk | Control | Verification |
|---|---|---|
| Demo OTP becomes a bypass | OTP generated randomly per request (`crypto.getRandomValues`), shown in a clearly labelled "Demo mode" panel; no fixed code like `123456`/`000000` accepted; demo adapter is selected only when `NEXT_PUBLIC_TAKI_MODE !== 'live'`; live adapter throws "not configured" rather than falling back | unit: adapter rejects `123456` unless it was the generated code; grep `src/` for `123456`, `000000`, `1234` in auth code |
| False SMS claim | copy on verify page in demo: "Demo code shown below — no SMS is sent" | e2e text assertion |
| Secrets in bundle | only `NEXT_PUBLIC_*` read in client; no `.env` committed | `security-check`: grep `.next/static/**/*.js` for `sk_`, `pk_live`, `secret`, `api_key`, `password=`, `BEGIN PRIVATE KEY`, `AKIA`, `AIza`; grep `src` for `process.env.` without `NEXT_PUBLIC_` in `'use client'` files |
| Card data | demo never renders PAN/CVV inputs; "Credit / Debit Card" selection shows demo notice only; nothing card-like stored in localStorage | e2e: inspect `localStorage` JSON for 13–19 digit sequences and `cvv` keys |
| Fake payment presented as real | payment page + confirmation show "Demo payment — no money is charged"; receipt labelled demo; no "Transaction successful" bank wording | e2e text assertion |
| Client guards mistaken for auth | role guard in client is UX only; documented in README; no "secure" claims; production requires server session (proxy/middleware) | doc review |
| localStorage persistence | store key namespaced (`taki-demo-v1`), versioned with migration/reset; "Reset demo data" control; malformed JSON → reset not crash | unit: corrupt storage → default state |
| Non-idempotent payment/booking | `createBooking(idempotencyKey)` where key = shipment draft id; Pay button disabled on first click; store rejects duplicates | unit + e2e double-click |
| Open redirect via `?next=` | `safeRedirect(next, role)`: allow only strings starting with `/`, not `//`, not `/\`, no scheme, no control chars, decoded once, **and within the role's prefix** (`/customer/` or `/driver/`); else role dashboard | unit table (see §9) |
| Cashfree stub routes (`src/app/api/payments/cashfree/{order,verify,webhook}`) | return 501 when env not configured; secrets read server-only (no `NEXT_PUBLIC_`); amount computed server-side from booking, never trusted from client; webhook must verify signature before any state change; verify is idempotent | e2e/request: POST each → 501 in demo; grep bundle for `CASHFREE` secret names |
| XSS | no `dangerouslySetInnerHTML` with user/store data; user text rendered via JSX; no `eval`/`new Function` | grep `src/` for `dangerouslySetInnerHTML`, `innerHTML`, `eval(` — only allowed for JSON-LD with static content |
| Map misrepresented as live GPS | label "Illustrative route map — not live tracking"; "View Live Route" renamed or tooltip/caption "Demo"; landing "track in real time" qualified | e2e text assertion; copy review |
| Synthetic vehicle images | no "verified fleet" claims; verified tick denotes demo KYC status in copy | copy review |
| Role confusion | customer cannot open `/driver/*` (redirect to own dashboard) and vice versa in demo session | e2e |
| Security headers | `next.config` headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, `Permissions-Policy` | e2e: response headers on `/` |

## 9. Unit test plan (Vitest)

| Module (proposed path) | Cases |
|---|---|
| `domain/pricing` | integer paise; each component `roundHalfUp(km×ratePerKmPaise)` and `roundHalfUp(kg×ratePerKgPaise)` → rupees via `Math.floor((p+50)/100)`. Cases: 498×₹12 + 500×₹0.50 = ₹6,226; Arjun 498×₹7.50 + 300×₹1.53 = 3,735 + 459 = ₹4,194; Meera 333×₹7.50 = 2,497.50 → 2,498, + ₹1,530 = ₹4,028. Fee slabs at boundaries: 500 → ₹350, 501 → ₹500, 1,000 → ₹500, 1,001 → ₹750, 2,000 → ₹750, 2,001 → ₹1,000. Total = transport + fee (4,500 + 350 = 4,850). Zero/negative inputs → error |
| `lib/format.ts` | `formatINR(186200)` → `₹1,86,200`; `formatINR(4850)` → `₹4,850`; `formatDate` → `20 Nov, 2025`; `formatTime` → `09:12 AM`; `formatKg(2000)` → `2,000 kg`; `formatPhone('9876543210')` → `+91 98765 43210`; timezone fixed to Asia/Kolkata |
| `lib/validation/*.ts` (zod) | every row of §7 as table-driven tests; phone regex `^[6-9]\d{9}$` |
| `domain/booking-machine` | every row of `data-contract.md` §4: pending_payment → paymentSucceeded → awaiting_driver (only if amount == totalPayable); → payment_failed; awaiting_driver → accept → confirmed (guard weight ≤ available, route not departed); → decline → declined (+refund); → cancel → cancelled; confirmed → picked_up → in_transit → out_for_delivery → delivered. Illegal transitions throw; the same event repeated in the target state is a no-op; one status event is appended per transition; terminal: delivered/declined/cancelled |
| `domain/capacity` | accept deducts weight once (idempotent); pending requests don't hold capacity; r1 sequence 2,000 → −300 → −1,000 = 700, Karthik 1,200 rejected; decline unchanged; customer cancel of confirmed releases capacity; available never < 0 |
| `lib/safe-redirect.ts` | allow `/customer/dashboard`, `/customer/a?b=c#d` for customer; reject `/driver/dashboard` for customer (→ own dashboard); reject `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`, `%2F%2Fevil.com`, `\\evil`, empty, non-string, `/\t/evil` → fallback |
| `lib/otp-demo.ts` | random 6 digits, expiry, attempts, cooldown, resend invalidates old; never accepts constant code |
| `store/*` | persistence version migration; corrupt JSON reset; idempotent `createBooking` |
| Search/filter | vehicles filtered by route match + capacity ≥ weight + date; sort cheapest first (Best Price), badges assigned deterministically |

Coverage target: ≥ 90% lines on `src/lib/**`; components not gated on coverage.

## 10. E2E specs (Playwright)

| Spec | Content |
|---|---|
| `customer-journey.spec.ts` | `/` → Ship Goods → `/signup` → Customer → phone → OTP (read demo code from page) → password → dashboard → fill Coimbatore/Chennai/500/20 Nov → vehicles (3) → Raj Transport → Book This Vehicle → payment (UPI default) → Pay ₹4,850 → confirmation → tracking timeline; then `/customer/shipments` lists it; `/customer/payments` lists ₹4,850; reload preserves state |
| `driver-journey.spec.ts` | `/` → List a Route → signup as driver → dashboard stats → Post a New Route → form → Next: Set Pricing → preview math updates live → Publish → `/driver/routes` shows route → `/driver/bookings` accept one / decline one → counts + capacity update → earnings page values |
| `auth-validation.spec.ts` | §7 phone, OTP, password rows; `/auth/login?next=//evil.com` lands on fallback; deep-link guard redirects to login then back to safe `next` |
| `navigation-links.spec.ts` | crawl header, sidebar (customer + driver), footer, back arrows, every CTA; assert status 200, no "404" text, correct `h1`; unknown route → custom not-found |
| `responsive.spec.ts` | §5 assertions for every route × 5 viewports |
| `a11y.spec.ts` | axe on every route (seeded state) + drawer open + error states shown; zero violations of serious/critical; keyboard-only run of customer journey |
| `visual.spec.ts` | screenshots to `test-results/visual/` (§3) |
| `integrity.spec.ts` | double-click Pay, back-then-Pay, double Accept, accept beyond capacity, localStorage scan for card data, demo labels present, security headers |

Global fixture: collect `page.on('console')` errors/warnings and `page.on('pageerror')`; fail the test on any
`error` (allow-list only documented third-party noise). Also fail on hydration-mismatch warnings and on
failed requests (`requestfailed`, responses ≥ 400 for same-origin assets).

## 11. Severity definitions and release gates

| Sev | Definition | Examples |
|---|---|---|
| P0 | blocks a core journey, data integrity/security flaw, or legal-misleading claim | Pay creates two bookings; fixed OTP accepted; open redirect; real-payment wording; build fails |
| P1 | major feature broken or WCAG A/AA failure on a core flow; layout broken on a matrix viewport | horizontal overflow at 390; drawer not keyboard-closable; OTP inputs unlabelled; contrast fail on primary button; console error |
| P2 | noticeable fidelity/UX defect with workaround | wrong radius/colour, text not verbatim, missing hover state, empty state missing |
| P3 | cosmetic / polish | 1–2px misalignment, tap target 24–43px on secondary control |

**Release gates (all required):** `npm run build` ✓, `tsc --noEmit` ✓, `npm run lint` 0 errors ✓,
`npm run test` ✓, `npm run test:e2e` ✓ (all specs), axe 0 serious/critical, security-check ✓,
zero open P0/P1, P2 count reviewed and accepted by lead, visual screenshots reviewed for all 15 crops.
