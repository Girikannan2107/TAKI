# QA — Customer Journey (T2, Phase 3)

Spec: `tests/e2e/customer-journey.spec.ts` (32 tests). Target: production build at `http://localhost:3100`, rebuilt with the R-01 fix.
Artifacts: `test-results/t2/pw/` (desktop), `test-results/t2/pw-mobile/` (mobile), `test-results/t2/pw-rerun/`.
The happy path uses only the real UI: no state injection and no frozen clock. Dates are relative to today (IST).

## Commands and results (2026-11-11, fresh build)

| Command | Result |
|---|---|
| `E2E_PORT=3100 npx playwright test tests/e2e/customer-journey.spec.ts --project=desktop --workers=1 --output=test-results/t2/pw` | 25 passed, 6 failed. 4 of the failures were environmental: the server was restarting (`ERR_CONNECTION_REFUSED`). The other 2 are defects C-01 and C-02. |
| same command with `--output=test-results/t2/pw-rerun -g "<the 4 env-failed tests>"` | 4/4 passed on rerun once the server was stable |
| `E2E_PORT=3100 npx playwright test tests/e2e/customer-journey.spec.ts --project=mobile --workers=1 --output=test-results/t2/pw-mobile -g "happy path"` | 1 passed (390×844) |

**Net: 29/31 pass on desktop. The 2 failing tests describe open defects C-01 and C-02. The mobile happy path passes.**

### Regression (2026-11-11, rebuild with the C-02 fix + shared visual fixes + seed version bump)
| Command | Result |
|---|---|
| `E2E_PORT=3100 npx playwright test tests/e2e/customer-journey.spec.ts --project=desktop --workers=1 --output=test-results/t2/pw` | **31 passed, 1 failed (environmental).** "demo customer login lands on the dashboard" timed out. The trace shows the initial `page.goto('/auth/login')` took 30 s to reach `load` while T1 was running, using up the 30 s test budget. There was no app error and no failed request. |
| same command with `-g "lands on the dashboard" --repeat-each=15 --output=test-results/t2/pw-flaky` | 15/15 passed (1.3–6.2 s each) |
| `... --project=mobile --workers=1 --output=test-results/t2/pw-mobile -g "happy path"` | 1 passed |

**Regression verdict: 32/32 functional pass. Both C-02 cancel tests pass; C-01 asserts the approved deviation. No new defects.**

## Test matrix

### 1. Happy path (real UI, desktop and mobile)
| Step | Result |
|---|---|
| `/` → Ship Goods → `/signup?role=customer` → I'm a Customer | Pass |
| Fresh mobile 98765 0xxxx → Send OTP → number shown as "+91 98765 0xxxx" | Pass |
| Read `demo-otp-code` → 5 digits: Verify disabled → 6th digit auto-submits | Pass |
| Full name + `Secure123` ×2 → Create Account → `/customer/dashboard`, "Hi, Priya" (also after reload) | Pass |
| Coimbatore → Chennai, 500 kg, tomorrow → URL `?from=coimbatore&to=chennai&weight=500&date=…` | Pass |
| "Available Vehicles (3)": ₹4,850 / ₹5,200 / ₹5,450 (also after reload) | Pass |
| View & Select Raj → `/customer/booking/rte_r1`: Raj Transport, route Coimbatore → Salem → Vellore → Chennai, total ₹4,850 (also after reload) | Pass |
| Book → `/customer/payment?bookingId=TAKI######`: ₹4,500 + ₹350 = ₹4,850 (also after reload) | Pass |
| UPI → Pay ₹4,850 → "Booking placed!", same booking ID, "Awaiting driver confirmation", no "Booking Confirmed" text (also after reload) | Pass |
| Track Shipment → current step "awaiting driver" (also after reload) → "Demo: simulate next update" → "Booking Confirmed" (persists across reload) | Pass |
| The booking appears in My Shipments, and in Payments as exactly 1 row, ₹4,850 | Pass |
| Log out from the sidebar (from the drawer on mobile) → log in as Ravi → `/driver/bookings?tab=accepted` shows the same booking ID, "Customer: Priya R." | Pass |
| No console errors, page errors or same-origin 4xx/5xx across the whole flow | Pass |

### 2. Login and resume
| Case | Result |
|---|---|
| Demo login (Arjun) → dashboard "Hi, Arjun" | Pass |
| Logged out `/customer/booking/rte_r1` → `/auth/login?next=%2Fcustomer%2Fbooking%2Frte_r1` → back on rte_r1 after login | Pass |
| Session expiry mid-flow (search kept) → login → rte_r1 with ₹4,850 and Book enabled | Pass |
| Logged out `/customer/payments` → login → returns to `/customer/payments` | Pass |
| Deep link with no search → "Enter shipment details" notice + dashboard link, no price, no enabled Book (C-01 approved deviation) | Pass |
| `next=` `https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:alert(1)`, `/driver/earnings`, `%2F%2Fevil.example` → `/customer/dashboard` on localhost | Pass (6/6) |
| Already signed in, visiting `/auth/login?next=//evil.example` → stays on the site | Pass |
| Customer visiting `/driver/bookings` → sent to the customer dashboard | Pass |

### 3. Invalid input
| Case | Result |
|---|---|
| Phone empty → "Enter your mobile number" + `aria-invalid` | Pass |
| Phone with 5 digits, or starting with 0 or 5 → "Enter a valid 10-digit Indian mobile number". Approved wording (customer-flow §3): one message rather than A-5's separate first-digit message | Pass |
| Letters cannot be entered (they are stripped); maxlength is 10 | Pass |
| Existing number at signup → "An account already exists for this number. Log in instead." | Pass |
| Incomplete OTP → Verify disabled; non-digits rejected | Pass |
| Wrong OTP → "Incorrect code. 4 attempts left." and the inputs are cleared | Pass |
| Resend: "Resend OTP in 00:xx" during the cooldown with no button; after 30 s (clock fast-forward) the button appears, a new code is issued and the old one is rejected | Pass |
| 5 wrong attempts → back to `/auth/phone` with "Too many incorrect attempts" | Pass |
| Direct visit to verify-otp or create-password with no prior state → `/auth/phone` | Pass |
| Password: missing name/password; `short1A`, `alllowercase1`, `NoNumbersHere` rejected; 1-character name rejected; mismatch → "Passwords don't match"; the eye toggle does not submit | Pass |
| Shipment: empty fields; same source and destination; weight 0 / 25,001 → range message; −5 → "Enter a number"; 12.5 kg → "whole number"; past date; date beyond 60 days | Pass |
| Tampered `/customer/vehicles` URL (negative weight, past date) → "Your search is incomplete" | Pass |
| 2,500 kg → Raj and Sree not listed, only Kavin (3,000 kg); deep link to rte_r1 → `offer-problem` shown and Book disabled | Pass |
| 3,500 kg → "No vehicles on this route yet" + "4 vehicles on this route don't have space for 3,500 kg" + Try next day | Pass |

### 4. Payment and booking integrity
| Case | Result |
|---|---|
| `payment?bookingId=TAKI000000`, `<script>`, or missing; confirmation unknown or missing; tracking unknown → "not found" and no Pay button | Pass |
| 3 synchronous clicks on Pay → 1 Paid row; the store holds 1 booking and 1 succeeded payment | Pass |
| Net Banking + Enter pressed twice → 1 payment, method recorded as "Net Banking" | Pass |
| Back from confirmation → booking details (payment was `replace`d), no Pay offered; Forward → confirmation; deep link to payment for a paid booking → redirected to confirmation; still 1 row | Pass |
| Simulated failure → error shown and Pay re-enabled; reload; retry → confirmation; 1 Paid + 1 Failed row, 1 booking | Pass |
| Another customer's IDs (TAKI874523, TAKI874391) → not found on tracking, payment and confirmation; absent from that customer's Shipments and Payments | Pass |
| Back from payment → Book again → same booking ID (idempotent) | Pass |
| Unpaid booking: My Shipments "Complete payment" → Cancel booking dialog → cancelled, no longer payable, listed under the Cancelled tab | Pass |
| Confirmation CTAs (View my shipments, Book another shipment); the notification bell deep-links to tracking | Pass |
| Customer cancels a paid booking, awaiting driver or confirmed before departure → dialog "Cancel this booking?" → toast "Booking cancelled — refund issued (demo)" → payment Refunded, listed under Cancelled (2 tests) | Pass (C-02 fixed) |

### 5. Navigation, console and copy honesty
| Case | Result |
|---|---|
| Landing header How it Works / Benefits / About / Contact → anchors exist | Pass |
| Footer: Ship goods, List a route, Log in, plus the Explore anchors | Pass |
| Sidebar Home / My Shipments / Payments / Profile → correct h1 and `aria-current="page"` | Pass |
| Bell panel; Account menu → Profile | Pass |
| Back arrows: vehicles → dashboard, booking → vehicles (results kept), payment → booking, tracking → shipments | Pass |
| View Route dialog; logo link; `/customer/does-not-exist` → branded 404 | Pass |
| One h1 per visited page; no console or page errors and no failed same-origin requests | Pass |
| Copy-honesty scan of every visited page (SMS sent / code sent to / live GPS / real-time / money debited / payment successful) | Pass: no hits |

## Defects

| ID | Sev | Page | Summary | Suspected file (owner) | Status |
|---|---|---|---|---|---|
| C-01 | P3 | `/customer/booking/[vehicleId]` (no search) | No inline weight + date mini-form (route-contract §9 l.137, customer-flow §9). The page shows "Price not shown yet" and an "Enter shipment details" link to the dashboard instead. | `src/features/booking/RouteBookingView.tsx` (D5) | **Won't fix: approved deviation** (Lead, 2026-11-11). The test now asserts the notice, the link and that no enabled Book button is shown. |
| C-02 | P2 | `/customer/tracking/[bookingId]` | No way to cancel a paid booking (awaiting_driver, or confirmed before departure) as customer-flow §12 requires. `marketplace.cancelBooking` supports it, but the only cancel button in the UI is the unpaid one on the payment page. | `src/features/tracking/TrackingView.tsx` (D6) | **Fixed:** verified in the regression on the rebuilt server (2 tests pass). |

Steps to reproduce:
- **C-01:** log in as Arjun in a fresh context, then open `/customer/booking/rte_r1`.
- **C-02:** book Raj, pay with UPI, then open `/customer/tracking/{id}`. There is no cancel control.

## Approved deviations
- **C-01:** a deep link to `/customer/booking/[id]` with no search shows the notice "Enter your shipment details to see the price for this vehicle" with an "Enter shipment details" link to `/customer/dashboard`. The inline mini-form of route-contract §9 is not built (Lead decision).

## Observations (not defects)
- With 2,500 kg, 1 result (Kavin) is listed and there is no hint that 2 other vehicles were excluded for lack of space. Per customer-flow §8 the hint is required only in the empty state.
- An explicit Log out clears the `search` slice, so the booking resume after a *logout* falls back to the "Price not shown yet" panel (C-01). The resume after *session expiry* keeps the search and works.
- Server latency under concurrent tester load caused occasional 30–40 s page loads (seen in 2 rounds, 1 test each). They passed on rerun or repeat. Not an app defect.
- During the first desktop run the server was briefly unavailable while it restarted (4 tests got `ERR_CONNECTION_REFUSED` / `ERR_ABORTED`). All 4 passed on rerun.
