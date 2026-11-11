# QA — Driver Journey (T3)

Spec: `tests/e2e/driver-journey.spec.ts` (15 tests) · Server: production build at http://localhost:3100 · Date: 2026-11-11
Owner: T3 (Driver Journey Tester). Artifacts: `test-results/t3/**`.

## Commands

```
E2E_PORT=3100 npx playwright test tests/e2e/driver-journey.spec.ts --project=desktop --workers=1 --output=test-results/t3/pw
E2E_PORT=3100 npx playwright test tests/e2e/driver-journey.spec.ts --project=mobile --workers=1 --output=test-results/t3/pw-mobile -g "@happy"
```

## Results (latest run)

| Project | Scope | Result |
|---|---|---|
| desktop 1440×900 | full spec (15) | **14 passed · 1 failed** (R-01, open) |
| mobile 390×844 | happy path (`@happy`) | **1 passed** (no horizontal scroll on dashboard, form, pricing, routes, vehicles) |

Every test checks that it logged no console errors or page errors (R-8). None were logged.

## Test matrix

| # | Area | Case | Criteria | Result |
|---|---|---|---|---|
| 1 | Signup | `/` → List a Route → `/signup?role=driver` → Lorry Driver → new mobile → Send OTP → demo code → Verify (auto-submits on the 6th digit; button disabled at 5) → name + business + password → Create Account | A-*, driver-flow §1 | Pass |
| 2 | New-driver dashboard | "Hi, Selvi", ₹0, no trend, tiles 00/00/00/—, no NaN/undefined | driver-flow §2 | Pass |
| 3 | New-driver empty states | Routes "You haven't listed a route"; Requests (0) "No pending requests"; Earnings ₹0, Withdraw disabled, "No settlements yet" | D-14, D-20 | Pass |
| 4 | Add Route | Coimbatore→Chennai; stops removed, Salem + Vellore added, Vellore removed and re-added; picker hides From/To and existing stops; 498 km; date T+5, 08:00, `new:tata_407`, 3,000/2,000 | driver-flow §4 | Pass |
| 5 | Set Pricing | ₹12/₹0.50 → 498 km × ₹12 = ₹5,976; 500 kg × ₹0.50 = ₹250; ₹6,226 | data-contract §5 | Pass |
| 6 | Publish | → `/driver/routes`; card shows path, "2,000 kg available of 3,000 kg", "₹12/km · ₹0.50/kg", Tata 407, Active; dashboard Active 01, capacity 2,000 kg | D-14 | Pass |
| 7 | Cross-role | Log out → Arjun searches Cbe→Chn 500 kg on T+5 → new driver's offer listed at ₹6,576 (6,226 + ₹350 fee) | data-contract §7 | Pass |
| 8 | Demo driver login | Ravi +91 98765 43211 / Taki@2025 → "Hi, Ravi", requests 05 | plan #8 | Pass |
| 9 | Accept | Requests (5); Arjun ₹4,194, Meera ₹4,028; accept Arjun → (4); r1 1,700 kg on My Routes and the dashboard; tile 04 | D-15–D-17 | Pass |
| 10 | Overbook | Accept Meera → 700 left; Karthik's Accept disabled, "Not enough capacity — 700 kg left, needs 1,200 kg"; Decline enabled | D-18 | Pass |
| 11 | Decline | Dialog "Decline this request?"; Esc cancels; confirm → Declined tab; r1 still 700 kg; tile 02 | D-19 | Pass |
| 12 | Idempotent accept | Double-click Accept (Divya, r2 800 kg) + reload + stale second tab → r2 = 1,200 kg once; one accepted card | D-17, S-7 | Pass |
| 13 | Shipment → delivered | TAKI874523: Mark out for delivery → Mark delivered (dialog "₹4,500 will be credited") → "Earnings credited"; earnings ₹33,000 / this month ₹33,000 / total ₹1,90,700; dashboard ₹33,000 | driver-flow §7 | Pass |
| 14 | Pickup guard | TAKI874611 (r1, T+1) "Mark picked up" should be disabled with "Available on …" | data-contract §4 #12 | **Fail → R-01** |
| 15 | Earnings | ₹28,500 / ₹28,500 / ₹25,400 / ₹1,86,200; TAKI874391 ₹6,226 Paid | D-21 | Pass |
| 16 | Withdraw | ₹99 → "Minimum withdrawal is ₹100"; ₹28,501 → max error (balance kept); ₹10,000 → ₹18,500, history ₹10,000 "Demo"; month/total unchanged | D-22 | Pass |
| 17 | Route form invalid | From = To; available > total; total > 3,000 vehicle max; −100 (whole kg); 0 (min 100); 12.5; past date; > 60 days | data-contract §10 | Pass |
| 18 | Missing time | Draft without a departure time → "Choose a departure time"; pricing guard sends it back to Add Route | driver-flow §4–5 | Pass |
| 19 | Duplicate stop | Stop equal to From → "Each stop must be a different city…"; picker never offers duplicates | §10 | Pass |
| 20 | Same-day lead | Today 00:00 → "Departure must be at least 1 hour from now" | §8 | Pass |
| 21 | Vehicle clash | veh_raj on T+1 → "Tata 407 (TN 37 XX 4587) already has a route on …" | driver-flow §4 | Pass |
| 22 | Pricing invalid | km −5, 0, abc, 12.345, 100.01; kg −1, 20.5, empty → inline alert, preview "—", Publish disabled; boundaries ₹1/₹0 (₹498) and ₹100/₹20 (₹59,800) accepted | §10 | Pass |
| 23 | Publish idempotent | Double-click Publish → one new route (4 active) | S-7 | Pass |
| 24 | Pricing guard | `/driver/routes/new/pricing` with no draft → `/driver/routes/new` | acceptance §validation | Pass |
| 25 | Role guard | Customer on /driver/dashboard, bookings, earnings, routes/new → `/customer/dashboard` | S (role confusion) | Pass |
| 26 | Login with next | Logged out `/driver/earnings` → `/auth/login?next=%2Fdriver%2Fearnings` → driver login → `/driver/earnings` | S-8 | Pass |
| 27 | Sidebar | Dashboard, My Routes, Booking Requests, Earnings, Profile, Help → correct h1 + `aria-current="page"`, no 404 | N-* | Pass |
| 28 | Stat cards | Active Routes, Booking Requests, Completed Trips (`?status=completed`), Available Capacity, earnings hero → real pages | D-* | Pass |
| 29 | Help | FAQ opens and closes; links return < 400; Post a New Route / Booking Requests CTAs navigate; external links use noopener | D-25 | Pass (see R-02) |

## Defects

| ID | Sev | Page | Summary | Suspected file | Status |
|---|---|---|---|---|---|
| R-01 | P2 | `/driver/bookings?tab=accepted` | "Mark picked up" is enabled for a confirmed booking whose travel date is in the future (TAKI874611, T+1). Clicking it moves the booking to Picked Up a day early. Contract §4 #12 requires today ≥ travelDate; driver-flow §7 requires a disabled button with "Available on <date>". Screenshot: `test-results/t3/pw/driver-journey-T3-Ravi-boo-98be3-king-can-t-be-picked-up-yet-desktop/test-failed-1.png` | `src/lib/domain/commands.ts` / `booking-machine.ts` (guard, Lead); `src/features/driver-requests/BookingRequestCard.tsx` (disabled + hint, D8) | Open (reported) |
| R-02 | P3 | `/driver/help` | FAQ uses native `<details>/<summary>`, not the `button[aria-expanded]` that D-25 specifies. It is accessible natively; the Lead can accept it as a deviation. | `src/features/help/HelpView.tsx` (D7) | Open (reported) |

## Notes / observations (not defects)

- A new driver has no "Add your vehicle" prompt. Approved decision #8 creates the vehicle on first publish from the chosen `new:<model>`, and the Add Route form defaults to the first model (Tata Ace, 750 kg).
- Booking-request lists sync across tabs (`storage` listener in `StoreHydrator`). The stale-tab test clicks Accept only if the button is still enabled. Either way, capacity was deducted only once.
- Publishing an unchanged draft twice is guarded by `marketplace.once(publish:<draft>)`. One route is created.
