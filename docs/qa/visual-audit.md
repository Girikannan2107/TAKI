# Visual Fidelity Audit (T1)

Production build at `http://localhost:3100`, compared with `references/screens/NN-name.png` (2× crops of the board) and `references/Reference.jpeg`. Approved deviations come from `docs/planning/implementation-plan.md` §1 and are not counted as bugs.

## Method

- Capture spec: `tests/e2e/visual.spec.ts`. Run with `E2E_PORT=3100 npx playwright test tests/e2e/visual.spec.ts --project=desktop --workers=1 --output=test-results/t1/pw`.
- Viewports: desktop 1440×900 and mobile 390×844, full-page captures. A hero probe also runs at 768, 900, 1024, 1100, 1180 and 1279 (viewport only).
- Clock frozen at 2025-11-19 10:00 IST (tracking: 2025-11-20 14:00 IST). State is injected through `taki-demo-v1` (session, search, routeDraft). Verify OTP and Create Password come from driving the real signup flow.
- Guards in the spec:
  - A capture fails if the app stylesheet is not applied. One early run hit the server mid-restart and produced unstyled pages, which were discarded.
  - Horizontal overflow (page and scroll strips) is recorded to `test-results/t1/overflow/*.json`.
- Limits of the comparison: the board panels are compressed single-column thumbnails, while the app is a full-size responsive layout. I judged composition, hierarchy, colour, radii, imagery and adaptation, not pixels. **No pixel-perfect equivalence is claimed.**
- Capture artifact, not a bug: in full-page desktop captures the sidebar appears to stop at 900px. It is `position: fixed` (`DashboardShell.tsx`) and covers the viewport in real use.

## Screenshots

`test-results/visual/` holds these captures (each with `-desktop.png` and `-mobile.png`):

- 01-landing
- 02-role-selection
- 03-mobile-number
- 03b-login
- 04-verify-otp
- 05-create-password
- 06-customer-dashboard
- 07-available-vehicles
- 08-route-booking-details
- 09-payment
- 10-track-shipment
- 11-driver-dashboard
- 12-add-new-route
- 13-set-pricing
- 14-booking-requests
- 15-earnings

It also holds the hero probe captures `01-landing-hero-{768,900,1024,1100,1180,1279}.png`.

Detail crops and contact sheets are in `test-results/t1/crops/`.

## Per-screen notes

Legend: **M** = matches the board · **A** = approved deviation · **D** = discrepancy (bug ID).

| # | Screen | Verdict | Notes |
|---|---|---|---|
| 01 | Landing | M / A / D | **M:** hero composition, green gradient into the photo, pill, two-line headline, lime Ship Goods and outlined List a Route buttons, and the overlapping "How TAKI Works" card with three steps and arrows. **A:** pin logo, "track every step". **Below the fold:** extra sections (Benefits, What you can ship, two-way CTA, About, Contact, footer) are consistent with the tokens. **Cargo images:** clean, with no baked-in captions; the known issue is resolved. **Mobile:** stacks well, with no overflow. **D:** header jammed against the hero card's top edge (V-03); hero photo upscaled at 768–1279 (V-02). |
| 02 | Role selection | M / D | Centred card, logo, title, subtitle, two option rows with icon, title, subtitle and chevron, plus the wave. Icons sit in light-green tiles; the board has plain outline icons (acceptable). On the board the Customer row looks pre-selected (green border and tint), but ours rows are neutral. Wave thinner and paler (V-10). |
| 03 | Mobile number | M / A / D | +91 flag prefix, divider, full-width green Send OTP. **A:** "We'll generate…" copy and DemoBanner. **D:** h1 wraps to two lines on desktop (V-09). |
| 04 | Verify OTP | M / A | Six boxes, "Resend OTP in 00:30" with the timer in bold, full-width Verify (disabled until complete). **A:** "Enter the 6-digit code for" and the DemoBanner showing the code. |
| 05 | Create password | M / A | Lock and eye inputs, three-item checklist, Create Account. The Full name field is a necessary addition. Checklist uses empty circles until met (board shows the met state). |
| 06 | Customer dashboard | M / A | Dark green sidebar with a lime active pill, "Hi, Arjun 👋", New Shipment card with all fields and the CTA; values match the board. Desktop adds a Recent shipments card. Avatar is "AK" initials, since no avatar asset exists. Mobile uses a top bar and drawer. |
| 07 | Available vehicles | M / D | Summary bar, three cards: name, verified tick, rating, model and capacity, price, badges (Best Price, Top Rated, More Capacity in the board's colours), View & Select. **D:** Raj and Sree thumbnails are black-background cutouts (V-01). |
| 08 | Route & booking details | M / A / D | Provider strip, illustrative route map, stats 498 km / ~9 hr / 3 Stops, route line, Book This Vehicle. Desktop adds a summary column (A: numbers). **D:** black thumbnail (V-01); Chennai label sits on the route line (V-11). |
| 09 | Payment | M / A / D | Booking Summary, three method rows with radios (UPI selected, tinted), Pay ₹4,850. Mobile order matches the board (summary first). The UPI icon is generic rather than the UPI mark. **D:** orphan "·" separators in the meta line (V-08). |
| 10 | Track shipment | M / A / D | Very close match: booking ID with copy, round truck badge, timeline with ticks, and board dates reproduced exactly (09:12 / 11:30 / 07:00 PM). **A:** "View Route", demo simulate button, extra info cards. **D:** mobile "Booking ID:" wraps (V-08); black thumbnail (V-01). |
| 11 | Driver dashboard | M / D | Sidebar with six items and the active pill, greeting, dark earnings hero (₹28,500, ▲ +12%), four stat tiles (03 / 05 / 18 / 2,000 kg), Post a New Route. Adds Upcoming routes. **D:** sparkline trends down (V-04). |
| 12 | Add new route | M | From and To, stop chips with ×, Add Stop pill, date, time, vehicle, capacities, Next: Set Pricing. Labels sit above the fields rather than inline (fine at this size). Capacity inputs show "3000" without grouping. Adds a route-distance summary. |
| 13 | Set pricing | M / A / D | ₹ / km and ₹ / kg inputs; Price Preview card with the 498 km figures (A); green earnings band; info note; Publish Route. Inputs are full width where the board has compact right-aligned ones. **D:** registration splits across lines (V-08). |
| 14 | Booking requests | M / A / D | Header "(5)" (A), status tabs, package icon tile, Accept/Decline pair, green earnings box with ₹4,194 / ₹4,028 (A). **D:** over-wide cards at 1440 (V-06); tabs clipped at 390 (V-07). |
| 15 | Earnings | M / A / D | Green payout card with the lime Withdraw button, This Month / Last Month / Total rows, Recent Settlements with TAKI874391 (A) and Paid pills. Adds the 6-month chart and Payout history. **D:** stretched payout card (V-05); downward chart (V-04). |
| — | Login (`/auth/login`) | M | No board panel. Uses the same auth card, wave and DemoBanner with the seeded logins. |

## Bug table

| ID | Sev | Page / viewport | Summary | Suspected file | Status |
|---|---|---|---|---|---|
| V-01 | P2 | 07, 08, 10 / all | Tata 407 and Eicher Pro photos are cutouts on solid black and show as black tiles; the board uses road photos | `src/lib/domain/vehicles.ts:8-9` (map to `light_cargo_lorry_taki`, `multi_axle_container_taki`) | Reported |
| V-02 | P2 | 01 / 768–1279 | Hero uses `sizes="100vw"` but renders 1137–1251px, so the photo is upscaled up to 1.37× (768: 828w variant) | `src/features/landing/HeroSection.tsx:33` → `(min-width: 768px) max(1280px, 88vw), 100vw` | Reported |
| V-03 | P3 | 01 / ≥1024 | Fixed header sits at y=0 while the hero card starts at y=16; the Login button pokes above the card | `src/components/layout/SiteHeaderFrame.tsx` (`lg:translate-y-4` while overlay and unscrolled) | Reported |
| V-04 | P3 | 11, 15 / all | 6-month sparkline falls next to "▲ +12%"; the board curve rises | `src/lib/data/seed.ts:325` archivedMonths and payoutRows | Reported |
| V-05 | P3 | 15 / desktop | Payout card stretched to about 336px tall, leaving a large empty green block | `src/features/earnings/EarningsView.tsx:59` (`lg:items-start`) | Reported |
| V-06 | P3 | 14 / 1440 | Request cards span about 1118px with about 650px of dead space | `src/features/driver-requests/BookingRequestsView.tsx` lists (`max-w-3xl`) | Reported |
| V-07 | P3 | 14 / 390 | Tablist 545/356px: "Declined" clipped, "Withdrawn" hidden, no affordance | `src/components/ui/Tabs.tsx:48` / view | Reported |
| V-08 | P3 | 09, 10, 13 | Awkward wraps: orphan "·" separators, "TN⏎37 XX 4587", "Booking ID:⏎TAKI…" | `PaymentView.tsx`, `SetPricingView.tsx`, `BookingIdCopy.tsx` | Reported |
| V-09 | P3 | 03 / desktop | h1 wraps to two lines; the board shows one | auth page h1 size | Reported |
| V-10 | P3 | auth / all | Wave thinner and paler than the board (optional) | `src/components/layout/AuthLayout.tsx` | Reported |
| V-11 | P3 | 08 / all | Chennai map label overlaps the route line (optional) | `src/features/booking/RouteMap.tsx` | Reported |

Known items checked:
- **Cargo caption crops:** fixed. The four cards are clean at 1440 and 390.
- **Hero softness at 768–1279:** confirmed and quantified as V-02.

Mobile overflow: no page-level horizontal scroll on any of the 16 mobile captures (`scrollWidth` = 390). The only clipped strip is V-07.

## Overall assessment

The implementation is a **faithful, higher-fidelity responsive rendering of the board**.

- **Matches the board:** brand palette (forest green, lime active pill and CTAs, warm canvas), Montserrat/Inter hierarchy, card radii and soft shadows, sidebar look, auth card with wave, badge colours, and every screen's content and order.
- **Approved deviations:** the copy and number changes listed in plan §1 appear as specified.
- **Desktop layouts:** they deliberately widen the single-column board panels into two-column layouts, and the extra content (summaries, recent lists, demo notes) uses the same tokens.
- **Strongest matches:** tracking (10), auth (02–05), customer dashboard (06), available vehicles (07, apart from imagery) and the driver dashboard (11).
- **Weakest points:** imagery (V-01 black thumbnails on three customer screens, V-02 soft hero at tablet widths) and a few desktop proportion issues (V-05, V-06).
- **Severity:** no P0 or P1 visual defects. Once V-01 and V-02 are fixed, the remaining items are polish.
