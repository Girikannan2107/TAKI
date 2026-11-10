# TAKI Travel — Driver Flow (P3, Phase 1)

Types, pricing, capacity, formats and seed: `data-contract.md`. Paths/files/guards: P2 `route-contract.md`. This doc defines the business state, validation and edge rules per driver step.

## 0. Key decisions
1. **Ravi Kumar operates "Raj Transport"** — the same operator the customer sees as the cheapest offer. This lets a demo booking made as Arjun appear in Ravi's Booking Requests (shared persisted store).
2. A **booking request is a paid booking in status `awaiting_driver`** on one of the driver's routes. No separate request entity; request status is derived (§4 contract).
3. **Accept deducts capacity; decline never does; nothing is held while pending.** Accept is idempotent and blocked when it would overbook.
4. Driver **earnings = `transportationCharge`** of each delivered booking; the TAKI service fee is added for the customer, never deducted from the driver.
5. Add Route form state lives in the `routeDraft` slice (`RouteDraft`); a `Route` record is only created on **Publish** (status `published`).
6. Board's Add Route / Set Pricing values are the *example the form can reproduce*, not a prefill of a duplicate route: entering Coimbatore → Chennai via Salem, Vellore with the default rates shows exactly ₹5,976 + ₹250 = ₹6,226.

## 1. Sign-up / login (shared auth, see customer-flow §2–6)
- Role card "I'm a Lorry Driver — I want to list my route and earn" → `/auth/phone?flow=signup&role=driver`.
- Create password step collects Full name (required) and **Business name** (optional, 2–60; falls back to full name on customer cards).
- New driver lands on `/driver/dashboard` with an "Add your vehicle" prompt card (no vehicle ⇒ cannot publish routes). New drivers get `defaultRatePerKmPaise = 1200`, `defaultRatePerKgPaise = 50`, `ratingAvg 0`/`ratingCount 0` (card shows "New" instead of stars).
- Demo fill: Driver +91 98765 43211 / `Taki@2025` (Ravi).

## 2. Driver Dashboard `/driver/dashboard`
Greeting "Hi, Ravi" (+ waving-hand emoji) / "Your journey, your earnings." All numbers derived via `src/lib/domain/stats.ts` (contract §11.6):
| Tile | Definition | Seed value |
|---|---|---|
| Total Earnings (This Month) | Σ EarningEntry.amount credited in current IST calendar month (+ archived month if any) | ₹28,500 |
| "+12% vs last month" | `round((this − last) / last × 100)`; hidden if last = 0; ▲ green when ≥ 0, ▼ when < 0 | +12% |
| Active Routes | routes with status `published` (includes today's departed-but-not-completed r0) | 03 |
| Booking Requests | bookings `awaiting_driver` on own routes | 05 |
| Completed Trips | routes `completed` + Σ archived `completedRoutes` | 18 |
| Available Capacity | `availableCapacityKg` of the next published route whose departure is in the future; "—" if none | 2,000 kg |
- Sparkline = `monthlySeries` (last 6 months), decorative (`aria-hidden`), with text equivalent in the card.
- "+ Post a New Route" → `/driver/routes/new` (resumes an existing `routeDraft`; "Start over?" confirm offered).
- No vehicle yet → tiles show zeros and the primary CTA becomes "Add your vehicle" (opens vehicle form, §3.1).

## 3. My Routes `/driver/routes`
- Tabs/filter `status=active|completed|all`. Card: "Coimbatore → Chennai", stops line, date + departure "20 Nov, 2025 · 08:00 AM", vehicle "Tata 407 · TN 37 XX 4587", capacity bar "2,000 of 3,000 kg available", rates "₹7.50/km · ₹1.53/kg", counts "3 requests · 2 accepted", status badge (Active / In progress when departed / Completed / Cancelled).
- Actions: View requests (→ `/driver/bookings?tab=pending`), **Complete trip** (only when no booking in confirmed…out_for_delivery; confirm dialog) → `completed`, **Cancel route** (only when no booking in confirmed…out_for_delivery; pending ones auto-declined + refunded; confirm dialog) → `cancelled`.
- `?published=<id>` highlights the new card + toast "Route published".
- Empty: "You haven't listed a route" + "Post a New Route".

### 3.1 Vehicle (profile or inline in Add Route when driver has none)
- Model select (catalogue §11.3: label "Tata 407 (Light Truck)"), registration number (normalised to "TN 37 XX 4587", regex §10), max payload prefilled from model (editable down, not above model max), body type. Writes `Vehicle`. Duplicate registration across drivers → "This vehicle is already registered".

## 4. Add New Route `/driver/routes/new`
Fields (writes `routeDraft` on every change, persisted):
| Field | Rule |
|---|---|
| From / To | city combobox; different cities |
| Intermediate Stops (optional) | chips + "+ Add Stop" (combobox), remove ×; ≤ 5; unique; ≠ From/To; order = insertion (drag-reorder optional) |
| Travel Date | today … today+60 (IST) |
| Departure Time | select, 30-min steps, "08:00 AM"; if travel date = today, ≥ now + 1 h |
| Vehicle Type | select over driver's vehicles, label "Tata 407 (Light Truck)" |
| Total Capacity | integer kg, 100 … vehicle max; defaults to vehicle max |
| Available Capacity | integer kg, 100 … Total; this becomes `offeredCapacityKg` |
- Live summary under stops: "Coimbatore → Salem → Vellore → Chennai · 498 km · ~9 hr" computed from `LEG_KM` (fallback haversine × 1.25).
- Guard: another `published` route for the same vehicle on the same travel date → "Tata 407 (TN 37 XX 4587) already has a route on 20 Nov, 2025".
- "Next: Set Pricing →" validates all fields, then → `/driver/routes/new/pricing`. Back → dashboard (draft kept); "Discard draft" → confirm → clear.

## 5. Set Pricing `/driver/routes/new/pricing`
- Guard: no `routeDraft` or draft invalid → `/driver/routes/new`.
- "Enter your rates for this route". Inputs prefilled from Driver defaults (Ravi: ₹12 / km, ₹0.50 / kg); decimal keypad; ≤ 2 decimals; per-km ₹1–₹100, per-kg ₹0–₹20. Stored as paise.
- **Price Preview (example)** — recomputes on input (debounce 150 ms) with `quote(distanceKm = route distance, weightKg = 500)`:
  - "For 500 kg (≈ 498 km)"
  - "Distance charge (498 km × ₹12)" ₹5,976
  - "Weight charge (500 kg × ₹0.50)" ₹250
  - "Your Earnings (before TAKI fee)" **₹6,226**
  - Info: "The customer will see a final price with a small TAKI service fee added." Optional tooltip "e.g. +₹350 for loads up to 500 kg" (fee slab §5).
  - Invalid rate → preview shows "—" and Publish disabled.
- "Publish Route →" (disabled while pending; idempotent on draft id) → creates `Route` {status `published`, `availableCapacityKg = offeredCapacityKg`, `durationMins = estimateDurationMins(distanceKm)`, `publishedAt`}, updates Driver default rates to the entered ones, writes Notification `route_published`, clears `routeDraft` → `router.replace('/driver/routes?published=<id>')`.
- Re-validate at publish: travel date/time still in future and no vehicle/date clash; otherwise back to Add Route with the error.

## 6. Booking Requests `/driver/bookings` (tab `pending` default)
- Header "Booking Requests (5)". Pending list = own bookings in `awaiting_driver`, newest first. Card (board layout):
  - "Coimbatore → Chennai" (customer's segment), "300 kg | 20 Nov, 2025" (route travelDate), "Customer: Arjun K.", "Your Earnings **₹4,194**" (= `pricing.transportationCharge`), Accept / Decline.
  - Secondary line: route label + "700 kg left on this route" so capacity is visible.
- Seed pending (contract §11.5): Arjun K. ₹4,194 · Meera S. ₹4,028 · Karthik R. ₹4,611 · Senthil P. ₹2,448 · Divya M. ₹3,020.
- **Accept** (transition #7): guards — route `published`, departure in future, `weightKg ≤ route.availableCapacityKg`. Effects — status `confirmed`, `availableCapacityKg −= weightKg`, event appended, customer notified `booking_accepted`, toast "Request accepted", card moves to Accepted tab. Double tap / second tab: already `confirmed` ⇒ no-op success (no second deduction).
  - Would overbook → Accept disabled, reason text "Not enough capacity — 700 kg left, needs 1,200 kg"; Decline still available. Seed demo: accept Arjun + Meera on r1 → Karthik blocked.
- **Decline** (transition #8): ConfirmDialog "Decline this request? The customer will be refunded." → status `declined`, Payment `refunded` (demo), capacity unchanged, customer notified, toast "Request declined".
- Already declined/cancelled when clicked (e.g. customer cancelled meanwhile) → toast "This request is no longer pending", list refreshes.
- Route departs with requests still pending → auto-declined + refunded (#10), evaluated on load.
- Tabs: **Pending** · **Accepted** (confirmed…out_for_delivery = Manage Shipments, §7) · **Declined** (declined) · **Withdrawn** (customer cancelled while pending). Empty pending: "No pending requests" + "Post a New Route".

## 7. Manage Shipments (`/driver/bookings?tab=accepted`)
- Card per accepted booking grouped by route/date: customer short name, segment, weight, earnings, status pill, customer masked mobile.
- One primary button per status, each a single transition with ConfirmDialog only for Delivered:
| Status | Button | Transition | Guard |
|---|---|---|---|
| confirmed | Mark Picked Up | #12 | today ≥ travelDate (else disabled "Available on 20 Nov, 2025") |
| picked_up | Start Transit | #13 | — |
| in_transit | Out for Delivery | #14 | — |
| out_for_delivery | Mark Delivered | #15 | — |
- #12 sets `expectedOutForDeliveryAt` (contract §8). #15 creates `EarningEntry` (amount = transportationCharge, status `paid`, creditedAt now) and notifies customer.
- Each change updates the customer's tracking timeline (same store). Labelled "Demo: status updates are manual; no GPS".
- When the last active booking of a departed route is delivered, prompt "Complete trip?" → route `completed`.

## 8. Earnings `/driver/earnings`
All via `src/lib/domain/earnings.ts` (contract §11.6); never stored as totals.
- **Available for Payout** = Σ EarningEntry + Σ ArchivedEarningsMonth − Σ Payout (status ≠ failed) → ₹28,500.
- This Month ₹28,500 · Last Month ₹25,400 · Total Earnings ₹1,86,200.
- **Recent Settlements**: EarningEntry newest first, 5 shown + "View all": "TAKI874391 · Coimbatore → Chennai · ₹6,226 · Paid". "Paid" means credited to the TAKI balance (not yet withdrawn) — tooltip says so.
- **Withdraw** → modal: amount (integer, default = full available, min ₹100, max available), destination "HDFC Bank ••••4321", DemoBanner "Demo payout — no money moves". Confirm (idempotency key per modal open) → Payout `processing` → `completed` after ~1.5 s (demo), Notification `payout_completed`, toast "₹28,500 withdrawal completed (demo)". Available becomes ₹0; This Month/Total unchanged.
  - Disabled when available < ₹100 ("Minimum withdrawal is ₹100"). No payout account → "Add bank details in Profile" (demo form: bank name + last 4 only; never full account numbers).
- Payout history section (newest first): date, amount, status. Empty states: "No settlements yet — complete a delivery to get paid".

## 9. Profile & Help
- `/driver/profile`: name, business name, mobile (read-only), vehicles (list + add, §3.1), payout account (bank name + last 4), default rates (₹/km, ₹/kg), change password, Reset demo data, Log out.
- `/driver/help`: FAQ incl. "How is my price calculated?" (formula in plain words: km × your per-km rate + kg × your per-kg rate; TAKI adds a small service fee for the customer).

## 10. Cross-role demo script (for e2e and walkthroughs)
1. Log in as Arjun → dashboard prefilled (Coimbatore → Chennai, 500 kg, T+1) → Raj Transport ₹4,850 → Book → Pay (UPI, demo) → "Awaiting driver confirmation".
2. Log out → log in as Ravi → dashboard Booking Requests **06** → Booking Requests shows Arjun K. 500 kg "Your Earnings ₹4,500" at the top.
3. Accept → r1 available 2,000 → 1,500 kg; dashboard Available Capacity 1,500 kg.
4. Log in as Arjun → tracking shows "Booking Confirmed" with the accept time.

## 11. Edge cases
| Case | Behaviour |
|---|---|
| Accept when capacity exactly equals weight | allowed; available becomes 0; route disappears from customer search |
| Accept/decline on another driver's booking (tampered id) | action throws `ForbiddenError`; UI shows generic error |
| Two pending requests together exceed capacity | both acceptable individually; second is blocked after the first |
| Rates of 0 per kg | allowed; weight line shows ₹0 |
| Route with no stops | "Direct" label; stops count shows 1 for customers |
| Publish double-click / refresh mid-publish | idempotent on draft id; single Route |
| Day rollover | on load only: accounts/vehicles kept, routes/bookings/earnings reseeded (contract §8) |
| Withdraw twice quickly | same key → one Payout |

## 12. Store writes per step
| Step | Writes |
|---|---|
| Sign-up | UserAccount, Driver, Session |
| Add vehicle | Vehicle |
| Add Route / Set Pricing | `routeDraft` |
| Publish | Route(published), Driver default rates, Notification, clear `routeDraft` |
| Accept | Booking(confirmed + event), Route.availableCapacityKg, Notification |
| Decline | Booking(declined + event), Payment(refunded), Notification |
| Status buttons | Booking(status + event, expectedOutForDeliveryAt), EarningEntry on delivered, Notification |
| Complete / Cancel route | Route(status, timestamps); cancel: pending bookings declined + refunds |
| Withdraw | Payout, Notification |
