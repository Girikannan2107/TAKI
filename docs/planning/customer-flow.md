# TAKI Travel — Customer Flow (P3, Phase 1)

Types, statuses, pricing, formats and seed values: `data-contract.md` (§ numbers point there). Paths, files, guards and query params follow P2's `route-contract.md`; this doc adds the **business state, validation and edge rules** per step. Where the two differ on booking status, this doc wins (P2 deferred status effects to P3).

## 0. Key business decisions affecting P2/P1
1. **Payment success → `awaiting_driver`, not `confirmed`.** The driver must Accept (driver-flow §6). Confirmation page headline "Booking placed!" + pill "Awaiting driver confirmation"; it reads "Booking Confirmed" once accepted. Payment page redirects away for any status other than `pending_payment`/`payment_failed`.
2. `/customer/booking/[vehicleId]` carries **`VehicleOffer.routeId`** (an offer is a route; a vehicle has many routes).
3. The offer is **recomputed** on every page from route + search query; nothing price-related is trusted from the previous page or the URL.
4. Prices on vehicle cards are **totalPayable** (incl. service fee) so card = Pay button (₹4,850).
5. Search state = URL query `from,to,weight,date` (CityId slugs; weight always integer kg — the unit select converts tonnes before writing the URL) (source of truth) mirrored into the `search` slice.

## 1. Landing `/`
- Reads `session` (client island) → header "Dashboard" vs "Log in". Writes nothing.
- Site-wide dismissible demo banner: "Demo mode — no real payments, SMS or GPS tracking."

## 2. Role selection `/signup`
- Two link-cards; customer → `/auth/phone?flow=signup&role=customer`. Signed-in users are redirected to their dashboard (GuestOnly).

## 3. Mobile number `/auth/phone`
- Input after fixed "+91": `inputmode="numeric"`, `autocomplete="tel-national"`, maxlength 10 (paste of "+91 98765 43210" / "098765 43210" is normalised first).
- Validate on blur + submit: `^[6-9]\d{9}$` → "Enter a valid 10-digit Indian mobile number".
- `flow=signup` and number exists (any role) → "This number already has an account. Log in instead" (one role per mobile in v1). `flow=login|reset` and unknown number → "No account for this number. Create one".
- Writes `pendingAuth`/`OtpChallenge` {code, expiresAt now+5m, resendAvailableAt now+30s}. Copy must not claim an SMS was sent: "Demo mode — your code is shown on the next screen."

## 4. Verify OTP `/auth/verify-otp`
- "Enter the 6-digit code sent to **+91 98765 43210**"; DemoBanner "Demo OTP: 428619" (`data-testid="demo-otp-code"`).
- 6 boxes: auto-advance, backspace-back, paste fills all, `autocomplete="one-time-code"`, auto-submit on 6th digit.
- Errors: wrong → "Incorrect code. 4 attempts left" (5 max → challenge void, back to phone with message); expired → "Code expired. Resend OTP". Resend: countdown "Resend OTP in 00:24", max 3 resends, new code each time.
- Success: signup/reset → create password; login → session → dashboard.

## 5. Create password `/auth/create-password`
- Signup adds **Full name** (needed for "Hi, Arjun"; not on board). Password + confirm with show/hide.
- Live checklist: At least 8 characters · One uppercase letter · One number; mismatch → "Passwords don't match"; max 64 chars.
- "Create Account" (disabled while pending, idempotent on mobile) writes `UserAccount` (salted hash), `Customer`, `Session` (7 days), clears `pendingAuth` → `/customer/dashboard`, toast "Welcome to TAKI, Arjun".
- Guard: no verified challenge (or verified > 10 min ago) → `/auth/phone`.

## 6. Login `/auth/login`
- Mobile + password. Generic error "Mobile number or password is incorrect" (no enumeration). 5 failures → locked 15 min ("Try again in 14 min").
- Demo fill (demo mode only, card labelled "Demo credentials"): Customer +91 98765 43210 / `Taki@2025` (§11.2). `next` must be a same-origin relative path.

## 7. Dashboard — New Shipment `/customer/dashboard`
- Greeting "Hi, {firstName}" (+ waving-hand emoji, as board) / "Where are we shipping today?".
- Form (react-hook-form + zod). Seeded Arjun is prefilled with the demo search (Coimbatore → Chennai, 500 kg, **T+1**); other users get the last search or empty fields with placeholders.
  - Source / Destination: combobox over `City` list, label "Coimbatore, Tamil Nadu"; same city → "Destination must be different from source".
  - Cargo weight: integer + unit kg | tonnes (t ×1000, ≤ 3 decimals); 10–25,000 kg.
  - Pickup date: min today, max today+60 (IST), past disabled; display "20 Nov, 2025".
  - Optional "More details": cargo type.
- Submit "Find Available Vehicles →" → writes `search`, pushes `/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=YYYY-MM-DD`.
- Below form: "Active shipment" card for bookings in awaiting_driver…out_for_delivery (seed: TAKI874523 In Transit → Track).

## 8. Available Vehicles `/customer/vehicles`
- Parse query with the same zod schema; invalid → EmptyState "Your search is incomplete" + "Edit search".
- `searchOffers()` (§7): header "Available Vehicles (3)", chips "Coimbatore → Chennai | 500 kg | 20 Nov, 2025" + Edit.
- Card: image, business + verified tick, "★ 4.8 (124 trips)", "Tata 407 | 2,000 kg available", "₹4,850", badge, "View & Select →". Default sort = price asc (P2 `sort=best` ≡ contract order §7; `price` same; `capacity` = availableCapacityKg desc).
- Seed result: Raj ₹4,850 Best Price · Sree ₹5,200 Top Rated · Kavin ₹5,450 More Capacity.
- Empty: "No vehicles found for Coimbatore → Chennai on 20 Nov, 2025." + if `excludedForCapacity > 0` "1 vehicle on this route doesn't have space for 500 kg — try a lower weight." + "Try next day" / "Try previous day" (only within allowed date range) + "Edit search".
- Loading skeletons (repo latency 150–400 ms); repo error → "Couldn't load vehicles. Retry".
- "View & Select" writes `selectedVehicleId = routeId`; no booking is created yet (no orphan drafts while browsing).

## 9. Route & Booking Details `/customer/booking/[routeId]`
- Recompute offer for (routeId, search). Shows: business, rating, "Tata 407 | TN 37 XX 4587" (full reg shown — public on the lorry anyway; P4 may mask), illustrative map captioned "Illustrative route — not live GPS", "498 km", "~9 hr", "3 Stops", "Route: Coimbatore → Salem → Vellore → Chennai", departure "08:00 AM · 20 Nov, 2025", price summary (Transportation ₹4,500 · Service fee ₹350 · Total ₹4,850).
- Deep link without search → inline mini-form (weight, date) prefilled from route; Book disabled until valid.
- No longer matching (capacity, departed, unpublished, date mismatch) → EmptyState "This vehicle is no longer available for 500 kg" + "Back to results".
- "Book This Vehicle →" → `createDraft` = transitions #1+#2: Booking `pending_payment` with pricing snapshot + Payment `initiated` (key `pay_{bookingId}_{attempt}`) → `/customer/payment?bookingId=…`. Re-click within 15 min for the same customer+route+search returns the same booking.

## 10. Payment `/customer/payment?bookingId=`
- Guards: unknown or other customer's booking → EmptyState → dashboard (never reveal existence). Status ∉ {pending_payment, payment_failed} → `router.replace` to confirmation (if awaiting_driver/confirmed) or tracking (later states/cancelled).
- Booking Summary from snapshot: Transportation Charge ₹4,500 · TAKI Service Fee ₹350 · **Total Payable ₹4,850**; collapsible booking details (id, route, weight, date, vehicle).
- Methods: UPI (GPay, PhonePe, Paytm) default · Credit / Debit Card · Net Banking. Demo adapter collects **no** card number, CVV, UPI PIN or bank login. "Demo payment — no money moves".
- Demo-only "Simulate payment failure" checkbox (hidden when `mode='live'`) for QA.
- "Pay ₹4,850 →": disabled + spinner while in flight; same key ⇒ same Payment record (double-click/refresh safe). `payment.amount` must equal `pricing.totalPayable` or the action throws.
  - Success → #3 → booking `awaiting_driver`, notifications (customer `payment_succeeded`, driver `booking_requested`) → replace to confirmation.
  - Failure → #4 → inline "Payment failed. No money was deducted (demo). Try again or choose another method." "Try again" → #5 new attempt key.
- Re-validate before paying: snapshot older than 15 min, or weight > route.availableCapacityKg, or route departed → "Availability changed — please review again" → booking `cancelled (quote_expired)` → back to details.
- Unpaid bookings auto-cancel 30 min after creation (checked on load). "Cancel booking" → ConfirmDialog → `cancelled (customer_cancelled)`.

## 11. Booking confirmation `/customer/booking-confirmation?bookingId=`
- Guard: status must be awaiting_driver…delivered, else redirect as §10.
- Shows new Booking ID (random `TAKI` + 6 digits) + copy, route, vehicle, pickup date/departure, "Paid ₹4,850 via UPI (Demo payment)", status pill, next step "Raj Transport will confirm your request. We'll notify you."
- CTAs: Track Shipment → `/customer/tracking/[id]` · Book another shipment · View my shipments. Writes nothing.

## 12. My Shipments & Track Shipment
- `/customer/shipments` tabs: **Active** (pending_payment, payment_failed, awaiting_driver…out_for_delivery) · **Completed** (delivered) · **Cancelled** (declined, cancelled). Row: id, "Coimbatore → Chennai", weight, date, status pill, total. pending_payment row → "Complete payment". Empty: "No shipments yet" + "Ship goods".
- `/customer/tracking/[bookingId]`: "Booking ID: TAKI874523" + copy; timeline from `statusHistory`:
  1. Booking Confirmed — "20 Nov, 09:12 AM" (while awaiting_driver: pending, "Waiting for Raj Transport to accept")
  2. Picked Up — "20 Nov, 11:30 AM"
  3. In Transit — "On the way to Chennai" (current step emphasised)
  4. Out for Delivery — not reached: "Expected: 20 Nov, 07:00 PM" from `expectedOutForDeliveryAt`; reached: its time
  5. Delivered — time when reached
  Done = filled check, current = bold, future = muted. Timestamps never invented: a step without an event shows no time.
- Declined → status card "Declined by Raj Transport — ₹4,850 refunded (demo)" + "Find another vehicle" (prefilled search). Cancelled → "Cancelled — ₹… refunded (demo)" when a payment had succeeded.
- "View Route" (renamed from "View Live Route") → modal with illustrative map, caption "Illustrative route — not live location".
- Driver contact (name + masked mobile "+91 98765 •••11") visible only from `confirmed` on.
- Customer cancel: awaiting_driver (#9) or confirmed before departure (#11); ConfirmDialog; refund message; confirmed cancel releases capacity.

## 13. Payments, Profile, Notifications
- `/customer/payments`: every Payment attempt, newest first: date, booking id, method label, amount, status Paid / Failed / Refunded + "Demo" tag.
- `/customer/profile`: name editable (2–60), mobile read-only, Change password (current + new, §10), Reset demo data (confirm), Log out.
- Bell: unread count (cap "9+"); panel newest first; click marks read + deep-links to tracking.

## 14. Edge cases
| Case | Behaviour |
|---|---|
| Session expired mid-flow | RequireRole → login with `next`; pending booking retained |
| Persisted state corrupt / old version | reseed, toast "Demo data was reset" |
| Day rolled over (`seededOn ≠ today`) | on load only: keep user accounts/vehicles/session, replace seed + all bookings/routes/payments (§8); toast "Demo data refreshed for today — demo bookings were reset" |
| Two tabs act on one booking | every action re-reads status; illegal transition → toast "This booking was updated" + refresh view |
| Weight above every route's capacity | empty state with capacity hint |
| Pickup today but routes already departed | excluded; empty state "Try next day" |
| Browser back after successful payment | payment guard redirects; no second charge |
| Driver declines while customer is on confirmation | page re-renders from store to Declined card |
| Route cancelled by driver | pending → declined + refund (#10); confirmed handled by lead decision (out of v1 scope) |

## 15. Store writes per step
| Step | Writes |
|---|---|
| Phone / Verify | `pendingAuth` (OtpChallenge), attempts/verifiedAt |
| Create password | UserAccount, Customer, Session |
| Find vehicles | `search` |
| Book This Vehicle | Booking(pending_payment) + Payment(initiated) |
| Pay | Payment(succeeded/failed), Booking(awaiting_driver/payment_failed), Notification ×2 |
| Cancel | Booking(cancelled), Payment(refunded if succeeded), Route.availableCapacityKg (+weight only if was confirmed) |
| Bell | Notification.readAt |
