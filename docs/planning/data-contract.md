# TAKI Travel — Data Contract (P3, Phase 1)

Source of truth for `src/lib/domain/*`. Types in §2 are to be implemented **verbatim** in `src/lib/domain/types.ts`.
Companion docs: `customer-flow.md`, `driver-flow.md`. All money, capacity and date rules below are binding for UI, store and tests.

## 1. Conventions
- **IDs**: strings. Internal ids are prefixed (`usr_`, `cus_`, `drv_`, `veh_`, `rte_`, `pay_`, `ern_`, `pyo_`, `ntf_`, `otp_`) + 10-char nanoid; seeds use readable ids (`drv_ravi`). Booking id is the public id `TAKI` + 6 digits (`/^TAKI\d{6}$/`), generated randomly, unique.
- **Dates**: calendar dates are `IsoDate` = `"YYYY-MM-DD"` interpreted in **Asia/Kolkata (IST)**; instants are `IsoDateTime` UTC (`toISOString()`); time-of-day is `"HH:mm"` 24h IST. "Today" always means today in IST.
- **Money**: every stored/displayed amount is **integer rupees** (`Rupees`) — matches the board ("₹4,850") and avoids float drift. Only **rates** are stored in **integer paise** (`₹0.50/kg` = 50, `₹7.50/km` = 750) because the board shows fractional rates. All arithmetic is integer: `paise → rupees` uses round-half-up. Floats never enter money code.
- **Units**: weight integer kg; distance integer km; duration integer minutes.
- **Derived vs stored**: totals, fees, earnings summaries and dashboard counts are **always computed** by pure, framework-free functions in `src/lib/domain/` (`pricing.ts`, `booking-machine.ts`, `capacity.ts`, `search.ts`, `earnings.ts`, `stats.ts`, `ids.ts`, `constants.ts` — P2 layout). The only stored money on a booking is its immutable `pricing` snapshot, itself produced by `quote()`.

## 2. Types
```ts
export type Id = string; export type BookingId = string; // BookingId: /^TAKI\d{6}$/
export type CityId = string;             // slug, e.g. "coimbatore"
export type IsoDate = string;            // "YYYY-MM-DD" (IST calendar date)
export type IsoDateTime = string;        // UTC instant, "2026-11-10T06:00:00.000Z"
export type TimeOfDay = string;          // "HH:mm" 24h IST, minutes 00 or 30
export type Rupees = number; export type Paise = number;  // both integer >= 0
export type Mobile = string;             // E.164 "+919876543210"
export type Role = 'customer' | 'driver';
export interface City { id: CityId; name: string; state: string; lat: number; lng: number }
export interface UserAccount {
  id: Id; role: Role; mobile: Mobile; profileId: Id;            // profileId -> Customer.id | Driver.id
  passwordHash: string; passwordSalt: string;                    // demo: salted SHA-256 (WebCrypto); never plaintext
  failedLoginCount: number; lockedUntil?: IsoDateTime; createdAt: IsoDateTime;
}
export interface Session { accountId: Id; role: Role; profileId: Id; issuedAt: IsoDateTime; expiresAt: IsoDateTime }
export interface OtpChallenge {
  id: Id; mobile: Mobile; role: Role; purpose: 'register' | 'reset_password';
  code: string;                                                  // demo adapter only: shown on screen, labelled "Demo OTP"
  createdAt: IsoDateTime; expiresAt: IsoDateTime; resendAvailableAt: IsoDateTime;
  attempts: number; resendCount: number; verifiedAt?: IsoDateTime;
}
export interface Customer { id: Id; fullName: string; mobile: Mobile; avatarKey?: string; createdAt: IsoDateTime }
export interface Driver {
  id: Id; fullName: string; businessName: string; mobile: Mobile; isVerified: boolean;
  ratingAvg: number; ratingCount: number;                        // shown as "★ 4.8 (124 trips)"
  defaultRatePerKmPaise: Paise; defaultRatePerKgPaise: Paise;    // prefill for Set Pricing
  payoutAccount?: { bankName: string; accountLast4: string };
  avatarKey?: string; createdAt: IsoDateTime;
}
export type VehicleModelId = 'tata_ace' | 'mahindra_bolero_pickup' | 'tata_407' | 'eicher_pro' | 'ashok_leyland_ecomet';
export type VehicleClass = 'Mini Truck' | 'Pickup' | 'Light Truck' | 'Medium Truck' | 'Heavy Truck';
export type VehicleImageKey =
  | 'green_tarpaulin_truck_taki' | 'light_cargo_lorry_taki' | 'medium_cargo_truck_taki' | 'large_curtainside_lorry_taki'
  | 'heavy_freight_lorry_taki' | 'mini_delivery_truck_taki' | 'multi_axle_container_taki' | 'medium_box_truck_generic';
export interface VehicleModel { id: VehicleModelId; label: string; vehicleClass: VehicleClass; maxPayloadKg: number; imageKey: VehicleImageKey }
export interface VehicleCapacity { maxPayloadKg: number; bodyType: 'open' | 'tarpaulin' | 'closed' | 'container' }
export interface Vehicle {
  id: Id; driverId: Id; modelId: VehicleModelId; registrationNumber: string; // normalised "TN 37 XX 4587"
  capacity: VehicleCapacity; imageKey: VehicleImageKey;
}
export type RouteStatus = 'draft' | 'published' | 'completed' | 'cancelled';
export interface IntermediateStop { cityId: CityId; kmFromOrigin: number }
export interface Route {
  id: Id; driverId: Id; vehicleId: Id;
  originCityId: CityId; destinationCityId: CityId;
  stops: IntermediateStop[];                                     // ordered, excludes origin/destination, max 5
  distanceKm: number;                                            // origin -> destination; km of destination
  durationMins: number;                                          // estimateDurationMins(distanceKm), computed at save
  travelDate: IsoDate; departureTime: TimeOfDay;
  ratePerKmPaise: Paise; ratePerKgPaise: Paise;                  // null-free; set on Set Pricing step
  totalCapacityKg: number;                                       // vehicle space this trip (<= vehicle maxPayloadKg)
  offeredCapacityKg: number;                                     // "Available Capacity" entered at creation (<= total)
  availableCapacityKg: number;                                   // remaining; invariant §6
  status: RouteStatus;
  createdAt: IsoDateTime; publishedAt?: IsoDateTime; completedAt?: IsoDateTime; cancelledAt?: IsoDateTime;
}
// Add Route / Set Pricing form state (store slice `routeDraft`). Publish turns it into a Route with status 'published';
// RouteStatus 'draft' is reserved for a later "save without publishing" feature and is not produced by v1 UI.
export interface RouteDraft {
  originCityId?: CityId; destinationCityId?: CityId; stopCityIds: CityId[];
  travelDate?: IsoDate; departureTime?: TimeOfDay; vehicleId?: Id;
  totalCapacityKg?: number; offeredCapacityKg?: number; ratePerKmPaise?: Paise; ratePerKgPaise?: Paise;
}
export type CargoType = 'general_goods' | 'agriculture' | 'construction' | 'industrial' | 'other';
export interface Shipment {                                      // also the search query
  sourceCityId: CityId; destinationCityId: CityId; weightKg: number; pickupDate: IsoDate; cargoType?: CargoType;
}
export interface PricingBreakdown {
  pricingVersion: 1;
  distanceKm: number; weightKg: number;                          // segment distance actually charged
  ratePerKmPaise: Paise; ratePerKgPaise: Paise;
  distanceCharge: Rupees;                                        // roundHalfUp(distanceKm * ratePerKmPaise / 100)
  weightCharge: Rupees;                                          // roundHalfUp(weightKg * ratePerKgPaise / 100)
  transportationCharge: Rupees;                                  // distanceCharge + weightCharge == driver earnings
  serviceFee: Rupees;                                            // serviceFeeFor(weightKg)
  totalPayable: Rupees;                                          // transportationCharge + serviceFee
}
export type OfferBadge = 'best_price' | 'top_rated' | 'more_capacity';
export interface VehicleOffer {                                  // derived search result, never stored
  routeId: Id; driverId: Id; vehicleId: Id;
  businessName: string; ratingAvg: number; ratingCount: number;
  vehicleLabel: string; registrationNumber: string; imageKey: VehicleImageKey;
  availableCapacityKg: number;
  pickupCityId: CityId; dropCityId: CityId; pathCityIds: CityId[]; // pickup..drop inclusive
  segmentKm: number; segmentDurationMins: number; stopsCount: number; // stopsCount = pathCityIds.length - 1
  travelDate: IsoDate; departureTime: TimeOfDay;
  pricing: PricingBreakdown; badge?: OfferBadge;
}
export type BookingStatus =
  | 'draft' | 'pending_payment' | 'payment_failed' | 'awaiting_driver' | 'confirmed'
  | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'declined' | 'cancelled';
export type BookingRequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn'; // derived, §4
export type CancelReason = 'customer_cancelled' | 'quote_expired' | 'route_departed' | 'route_cancelled';
export interface BookingStatusEvent { status: BookingStatus; at: IsoDateTime; by: 'customer' | 'driver' | 'system'; note?: string }
export interface Booking {
  id: BookingId; customerId: Id; driverId: Id; routeId: Id; vehicleId: Id;
  shipment: Shipment;                                            // pickup/drop must lie on route in order
  pricing: PricingBreakdown;                                     // snapshot at draft; immutable from pending_payment on
  status: BookingStatus; statusHistory: BookingStatusEvent[];   // append-only; timeline reads from here
  expectedOutForDeliveryAt?: IsoDateTime;
  cancelReason?: CancelReason;
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
export type PaymentMethod = 'upi' | 'card' | 'netbanking';
export type PaymentStatus = 'initiated' | 'succeeded' | 'failed' | 'refunded';
export type PaymentMode = 'demo' | 'live';
export interface Payment {
  id: Id; bookingId: BookingId; customerId: Id;
  amount: Rupees;                                                // must equal booking.pricing.totalPayable
  method: PaymentMethod; status: PaymentStatus; mode: PaymentMode;
  idempotencyKey: string;                                        // one key per attempt; replays return same Payment
  methodLabel?: string;                                          // masked only, e.g. "UPI", "Card •••• 4242"
  failureReason?: string; createdAt: IsoDateTime; completedAt?: IsoDateTime; refundedAt?: IsoDateTime;
}
export interface EarningEntry {                                  // a "settlement": created when booking -> delivered
  id: Id; driverId: Id; bookingId: BookingId; routeId: Id;
  sourceCityId: CityId; destinationCityId: CityId;
  amount: Rupees;                                                // == booking.pricing.transportationCharge
  status: 'paid'; creditedAt: IsoDateTime;                       // "Paid" = credited to driver's TAKI balance
}
export interface ArchivedEarningsMonth { driverId: Id; month: string; amount: Rupees; deliveries: number; completedRoutes: number } // month "YYYY-MM"
export type PayoutStatus = 'processing' | 'completed' | 'failed';
export interface Payout {
  id: Id; driverId: Id; amount: Rupees; status: PayoutStatus; mode: PaymentMode; idempotencyKey: string;
  destinationLabel: string; requestedAt: IsoDateTime; completedAt?: IsoDateTime;
}
export interface EarningsSummary {                               // derived
  availableForPayout: Rupees; thisMonth: Rupees; lastMonth: Rupees; total: Rupees;
  changePctVsLastMonth: number | null;                           // null when lastMonth === 0
  monthlySeries: { month: string; amount: Rupees }[];            // last 6 months, oldest first (sparkline)
}
export interface DriverDashboardStats {                          // derived
  earningsThisMonth: Rupees; changePctVsLastMonth: number | null;
  activeRoutes: number; pendingRequests: number; completedTrips: number;
  nextRouteAvailableCapacityKg: number | null;
}
export type NotificationKind =
  | 'booking_requested' | 'booking_accepted' | 'booking_declined' | 'booking_status_changed'
  | 'payment_succeeded' | 'payment_failed' | 'payment_refunded' | 'route_published' | 'payout_completed';
export interface Notification {
  id: Id; recipientRole: Role; recipientId: Id; kind: NotificationKind;
  title: string; body: string; bookingId?: BookingId; routeId?: Id; createdAt: IsoDateTime; readAt?: IsoDateTime;
}
export interface DemoMeta { seedVersion: number; seededOn: IsoDate }
```

## 3. Display labels
| BookingStatus | Customer label | Driver label |
|---|---|---|
| draft / pending_payment | Payment pending | — (invisible to driver) |
| payment_failed | Payment failed | — |
| awaiting_driver | Awaiting driver confirmation | New request |
| confirmed | Booking Confirmed | Accepted · awaiting pickup |
| picked_up / in_transit / out_for_delivery / delivered | Picked Up / In Transit / Out for Delivery / Delivered | same |
| declined | Declined by driver · refunded | Declined |
| cancelled | Cancelled | Cancelled by customer |

Badges: `best_price` "Best Price", `top_rated` "Top Rated", `more_capacity` "More Capacity". Cargo: General goods, Agriculture, Construction, Industrial, Other.

## 4. State machines
**Booking** (only these transitions exist; any other call throws `InvalidTransitionError`).
| # | From | Event (actor) | To | Guards | Effects |
|---|---|---|---|---|---|
| 1 | — | selectOffer (customer) | draft | offer bookable (§7), weight ≤ available | pricing snapshot via `quote()` |
| 2 | draft | bookThisVehicle (customer) | pending_payment | draft age ≤ 15 min, re-check capacity & rates | Payment `initiated` + new idempotencyKey |
| 3 | pending_payment | paymentSucceeded (system) | awaiting_driver | payment.amount == totalPayable | Payment `succeeded`; notify driver `booking_requested`, customer `payment_succeeded` |
| 4 | pending_payment | paymentFailed (system) | payment_failed | — | Payment `failed`; notify customer |
| 5 | payment_failed | retryPayment (customer) | pending_payment | same as #2 | new Payment attempt, new key |
| 6 | draft / pending_payment / payment_failed | abandon or expiry 30 min (customer/system) | cancelled | — | reason `quote_expired` or `customer_cancelled` |
| 7 | awaiting_driver | accept (driver) | confirmed | route published, not departed, weight ≤ route.availableCapacityKg | available −= weight; notify customer `booking_accepted` |
| 8 | awaiting_driver | decline (driver) | declined | — | Payment → `refunded`; capacity unchanged; notify customer |
| 9 | awaiting_driver | cancel (customer) | cancelled | — | refund; capacity unchanged |
| 10 | awaiting_driver | route departs / route cancelled (system) | declined | — | reason `route_departed`/`route_cancelled`; refund |
| 11 | confirmed | cancel (customer) | cancelled | before route departure | refund; available += weight |
| 12 | confirmed | markPickedUp (driver) | picked_up | today ≥ travelDate | set expectedOutForDeliveryAt (§8) |
| 13 | picked_up | startTransit (driver) | in_transit | — | — |
| 14 | in_transit | markOutForDelivery (driver) | out_for_delivery | — | — |
| 15 | out_for_delivery | markDelivered (driver) | delivered | — | create EarningEntry(amount = transportationCharge); notify customer |

Terminal: `delivered`, `declined`, `cancelled`. Each transition appends one `BookingStatusEvent`. **Idempotency**: repeating the same event on a booking already in its target state is a no-op returning success (e.g. double-tap Accept never deducts twice); `accept` on `declined`/`cancelled` throws.
**Derived request status**: `awaiting_driver`→`pending`; `confirmed…delivered`→`accepted`; `declined`→`declined`; `cancelled` after having been `awaiting_driver`→`withdrawn`. Never stored.
**Route**: RouteDraft →`published` (Publish; all fields valid, no other published route for the same vehicle on that travelDate) · `published`→`cancelled` (only if no booking in confirmed…out_for_delivery; pending ones auto-declined, #10) · `published`→`completed` (driver "Complete trip", only when no booking in confirmed…out_for_delivery). Rates/capacity are fixed once published (bookings keep snapshots anyway).
**Offer id**: P2's `/customer/booking/[vehicleId]` segment carries `VehicleOffer.routeId` (an offer *is* a route; one vehicle has many routes).

## 5. Pricing contract (pricing.ts)
```
roundHalfUp(paise)          = Math.floor((paise + 50) / 100)        // integer paise -> integer rupees
distanceCharge              = roundHalfUp(segmentKm * ratePerKmPaise)
weightCharge                = roundHalfUp(weightKg  * ratePerKgPaise)
transportationCharge        = distanceCharge + weightCharge          // = driver "Your Earnings"
serviceFeeFor(weightKg)     = ≤500 kg → ₹350 · 501–1,000 → ₹500 · 1,001–2,000 → ₹750 · >2,000 → ₹1,000
totalPayable                = transportationCharge + serviceFee
```
- Lines are rounded individually and totals are sums of displayed lines, so a breakdown always adds up on screen.
- `segmentKm` = kmFromOrigin(drop) − kmFromOrigin(pickup) (origin = 0, destination = distanceKm). Customers pay only their segment.
- Driver earnings = `transportationCharge`; TAKI keeps `serviceFee`. Driver never sees the fee deducted ("before TAKI fee" = fee is added on top for the customer).
- Set Pricing **preview** = `quote()` for an example 500 kg over the route's full `distanceKm`. Labelled "Price Preview (example)".
- Booking keeps its snapshot; later rate edits (draft only) never change existing bookings.

**Worked examples (every board number)**
| Board item | Inputs | Result |
|---|---|---|
| Raj Transport card / Payment (R1, TAKI874523 on R0) | 498 km × ₹7.50 = 3,735; 500 kg × ₹1.53 = 765 | transport **₹4,500** + fee ₹350 = **₹4,850** (card, summary, "Pay ₹4,850") |
| Sree Travels (S1) | 500 km × ₹8.50 = 4,250; 500 × ₹1.20 = 600 | 4,850 + 350 = **₹5,200** |
| Kavin Logistics (K1) | 520 km × ₹8.75 = 4,550; 500 × ₹1.10 = 550 | 5,100 + 350 = **₹5,450** |
| Set Pricing preview (Ravi defaults ₹12, ₹0.50; Cbe→Chn 498 km) | 498 × ₹12 = **₹5,976**; 500 × ₹0.50 = **₹250** | **₹6,226** "Your Earnings (before TAKI fee)" |
| Settlement row (TAKI874391, H1) | same as preview: 498 km, 500 kg, ₹12/₹0.50 | **₹6,226** Paid |
| Booking request Arjun K. (R1) | 498 × ₹7.50 = 3,735; 300 × ₹1.53 = 459 | **₹4,194** |
| Booking request Meera S. (R1, Salem→Chennai 333 km) | 333 × ₹7.50 = 2,497.50 → 2,498; 1,000 × ₹1.53 = 1,530 | **₹4,028** (half-up test case) |
| Earnings / dashboard | §11 ledger | ₹28,500 / ₹25,400 / ₹1,86,200 / +12% |

**Board numbers changed (and why)**
| Screen | Board | Contract | Reason |
|---|---|---|---|
| Set Pricing | "≈ 488 km", "(488 km × ₹12)" | **498 km** | 488 × 12 = 5,856 ≠ 5,976; route is 498 km |
| Booking Requests | "(2)" | **(5)** | dashboard says 05 pending; list shows all 5 |
| Booking Requests | Arjun K. ₹6,226 | **₹4,194** | 300 kg on R1 at R1 rates |
| Booking Requests | Meera S. ₹6,976 | **₹4,028** | segment 333 km; 6,976 implied full 498 km at ₹1/kg |
| Earnings | settlement **TAKI874523** | **TAKI874391** | TAKI874523 is still In Transit; only delivered bookings settle. ₹6,226 kept |
| All dated screens | "20 Nov, 2025" | relative dates (§8) | 2025 is in the past; tests freeze the clock for parity |

## 6. Capacity rules (capacity.ts)
1. Invariant: `availableCapacityKg = offeredCapacityKg − Σ weightKg of bookings in confirmed…out_for_delivery` and `0 ≤ available ≤ offered ≤ totalCapacityKg ≤ vehicle.capacity.maxPayloadKg`. Unit-tested after every store action.
2. Search shows a route only if `weightKg ≤ availableCapacityKg`. Draft/payment re-check the same rule.
3. Pending requests (`awaiting_driver`) do **not** hold capacity; several may exceed it. Accept re-checks; if `weightKg > available` Accept is disabled with the exact text "Not enough capacity — 700 kg left, needs 1,200 kg" (`Not enough capacity — {left} kg left, needs {weight} kg`, numbers en-IN grouped). Decline never changes capacity.
4. Capacity is route-level (not per leg) — conservative simplification; it is released only by customer cancellation of a confirmed booking, never on delivery.

## 7. Search & offer rules (search.ts)
Route matches query iff: `status === 'published'`; `travelDate === pickupDate`; departure instant (travelDate + departureTime IST) > now; `sourceCityId` is origin or a stop, `destinationCityId` is a later stop or destination; capacity rule §6.2; driver ≠ current user. Sort: `totalPayable` asc, then ratingAvg desc, then departureTime asc. Badges (only when ≥ 2 results): best_price = min totalPayable; top_rated = max ratingAvg; more_capacity = max availableCapacityKg; ties → earlier in sort order; an offer shows one badge (priority best_price > top_rated > more_capacity) and a lost badge is not reassigned. `excludedForCapacity` count is returned for the empty state.

## 8. Date & time rules
- `pickupDate` / `travelDate`: today ≤ date ≤ today + 60 days (IST). Travel date = today requires departure ≥ now + 1 h. Departure times on 30-min steps.
- `estimateDurationMins(km) = Math.round(km * 60 / 55)` (55 km/h). 498 km → 543 min → "~9 hr".
- `expectedOutForDeliveryAt` = pickedUpAt + segmentDurationMins − 60 min, rounded to nearest 30 min (seed stores board value).
- Leg distances: `LEG_KM` table (§11.1); missing pair → haversine × 1.25, rounded. Route km = Σ consecutive legs.
- **Seed dates are relative** to `T` = today (IST) at seeding; `DemoMeta.seededOn` = T. Seeding, "today", and every date-derived string (formatted dates, "this month", bookable/departed, countdowns) are computed **client-side after store hydration** from the browser clock; server HTML renders skeletons only for these parts (avoids hydration mismatch; lets Playwright's browser clock control them).
- **Day rollover** (checked on app load only, never mid-session): if `seededOn ≠ today`, keep user-created `UserAccount`/`Customer`/`Driver`/`Vehicle` records and the session; **replace** all seed records and all transactional data (routes, bookings, payments, earnings, payouts, notifications, `routeDraft`) with a fresh seed for the new T; toast "Demo data refreshed for today — demo bookings were reset". Rationale: user bookings reference seeded routes whose dates/capacity change, so keeping them would break invariants §6. Visual-parity tests freeze the browser clock (Playwright `page.clock`) before seeding: search, vehicles, details, payment, requests (all T+1) → `2025-11-19T10:00:00+05:30` (tech-architecture default) renders "20 Nov, 2025"; tracking (TAKI874523 is on day T) → `2025-11-20T14:00:00+05:30`.

## 9. Formatting (`src/lib/format/{currency,date,phone,units}.ts`, all `en-IN`)
| Kind | Rule | Example |
|---|---|---|
| Money | `Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0})` | ₹1,86,200 |
| Rate | 2 decimals unless whole | ₹12 · ₹0.50 · ₹7.50 |
| Weight / distance | en-IN grouping + unit | 2,000 kg · 498 km |
| Duration | `~{round(min/60)} hr`, `< 60` → `~{min} min` | ~9 hr |
| Date | `{d} {Mon}, {yyyy}` (no day padding) | 20 Nov, 2025 |
| Date-time (timeline) | `{d} {Mon}, {hh}:{mm} {AM/PM}` | 20 Nov, 09:12 AM |
| Time | `hh:mm AM/PM`, 2-digit hour | 08:00 AM |
| Mobile | `+91 XXXXX XXXXX` | +91 98765 43210 |
| Dashboard counts | 2-digit pad | 03 · 05 · 18 |
| Percent change | `+12% vs last month` / `−5% vs last month`, `Math.round` | +12% |
| Customer short name | first name + last initial + "." | Arjun K. |
| Route label | names joined by " → " | Coimbatore → Salem → Vellore → Chennai |

## 10. Validation (zod, shared client/store)
| Field | Rule | Message |
|---|---|---|
| Mobile | strip spaces/`+91`/leading 0, then `^[6-9]\d{9}$` | Enter a valid 10-digit Indian mobile number |
| OTP | `^\d{6}$`, ≤ 5 attempts, expires 5 min, resend after 30 s, ≤ 3 resends | Incorrect code. 4 attempts left |
| Password | 8–64 chars, ≥ 1 uppercase, ≥ 1 digit; confirm matches | per-rule checklist |
| Full name | 2–60 chars, letters/space/.'- | Enter your name |
| Business name | 2–60 chars | — |
| Registration no. | normalise to `AA 00 AA 0000`; `^[A-Z]{2} \d{1,2} [A-Z]{1,3} \d{4}$` | Enter a valid registration number |
| Cities | from city list; source ≠ destination; stops unique, ≠ endpoints, ≤ 5 | — |
| Cargo weight | integer kg, 10–25,000 (input unit kg or tonnes ×1000) | Weight must be between 10 kg and 25,000 kg |
| Capacities | total 100…vehicle max; offered 100…total | Available capacity can't exceed total capacity |
| Rates | per-km ₹1.00–₹100.00; per-kg ₹0.00–₹20.00; ≤ 2 decimals | — |
| Withdraw | integer ₹100 … availableForPayout (default = full balance) | Minimum withdrawal is ₹100 |

## 11. Seed data (`src/lib/data/seed/{cities,users,vehicles,routes,bookings,earnings,notifications}.ts`; `T` = today IST, `T+n` = n days later)
**11.1 Cities** (id: name, lat, lng; all Tamil Nadu unless noted): coimbatore 11.0168,76.9558 · tiruppur 11.1085,77.3411 · erode 11.3410,77.7172 · salem 11.6643,78.1460 · namakkal 11.2189,78.1677 · krishnagiri 12.5266,78.2150 · vellore 12.9165,79.1325 · kanchipuram 12.8342,79.7036 · chennai 13.0827,80.2707 · madurai 9.9252,78.1198 · tiruchirappalli 10.7905,78.7047 · hosur 12.7409,77.8253 · bengaluru (Karnataka) 12.9716,77.5946 · kochi (Kerala) 9.9312,76.2673.
`LEG_KM`: coimbatore–salem 165 · salem–vellore 205 · vellore–chennai 128 · coimbatore–chennai 498 · salem–chennai 333 · coimbatore–vellore 370 · coimbatore–tiruppur 52 · tiruppur–salem 116 · coimbatore–erode 102 · erode–salem 65 · salem–kanchipuram 280 · kanchipuram–chennai 73 · coimbatore–bengaluru 365 (symmetric).

**11.2 Accounts** (demo password for all seeded accounts: `Taki@2025`; seeded **only when `mode !== 'live'`**, and the login card labels them "Demo credentials")
| id | role | name | mobile | notes |
|---|---|---|---|---|
| cus_arjun | customer | Arjun Kumar (Arjun K.) | +91 98765 43210 | hero customer |
| cus_meera, cus_karthik, cus_senthil, cus_divya, cus_lakshmi, cus_priya, cus_anand, cus_gopal, cus_fathima, cus_suresh, cus_kalpana, cus_imran | customer | Meera Sundaram, Karthik Raman, Senthil Prakash, Divya Mohan, Lakshmi Venkat, Priya Natarajan, Anand Rao, Gopal Ramesh, Fathima Begum, Suresh Varma, Kalpana Devi, Imran Shaikh | +91 90000 000 01…12 | request/history customers |
| drv_ravi | driver | Ravi Kumar · **Raj Transport** | +91 98765 43211 | ★4.8 (124), defaults ₹12/km ₹0.50/kg, HDFC Bank ••••4321 |
| drv_sree | driver | Sridhar M. · Sree Travels | +91 90000 000 21 | ★4.9 (208) |
| drv_kavin | driver | Kavin R. · Kavin Logistics | +91 90000 000 22 | ★4.7 (89) |
| drv_murugan / drv_velan / drv_selvam | driver | Murugan Carriers / Velan Roadways / Selvam Logistics | +91 90000 000 23–25 | ★4.6 (41) / 4.5 (63) / 4.4 (37) |

**11.3 Vehicle models & vehicles**
| model | label | class | max kg | imageKey |
|---|---|---|---|---|
| tata_ace | Tata Ace | Mini Truck | 750 | mini_delivery_truck_taki |
| mahindra_bolero_pickup | Mahindra Bolero Pik-Up | Pickup | 1,500 | medium_box_truck_generic |
| tata_407 | Tata 407 | Light Truck | 3,000 | green_tarpaulin_truck_taki |
| eicher_pro | Eicher Pro | Medium Truck | 5,000 | medium_cargo_truck_taki |
| ashok_leyland_ecomet | Ashok Leyland | Heavy Truck | 7,000 | large_curtainside_lorry_taki |

Vehicles: veh_raj (drv_ravi, tata_407, **TN 37 XX 4587**, tarpaulin) · veh_raj2 (drv_ravi, tata_407, TN 37 BZ 1190 — Raj Transport's second lorry, runs r0) · veh_sree (eicher_pro, TN 38 BK 2211) · veh_kavin (ashok_leyland_ecomet, TN 66 AL 9034) · veh_murugan (mahindra_bolero_pickup, TN 37 CQ 7712) · veh_velan (tata_407, TN 33 BV 5520) · veh_selvam (eicher_pro, TN 30 AZ 1180). Each vehicle's imageKey = its model's.

**11.4 Routes** (stops as city@kmFromOrigin)
| id | driver | path | km | date / dep | rates km/kg | total / offered / avail | status |
|---|---|---|---|---|---|---|---|
| rte_r0 | ravi · veh_raj2 | Coimbatore → Salem@165 → Vellore@370 → Chennai | 498 | T 11:30 | ₹7.50 / ₹1.53 | 3,000 / 3,000 / 2,500 | published (departed) |
| rte_r1 | ravi · veh_raj | Coimbatore → Salem@165 → Vellore@370 → Chennai | 498 | T+1 08:00 | ₹7.50 / ₹1.53 | 3,000 / 3,000 / 2,000 | published |
| rte_r2 | ravi · veh_raj | Chennai → Vellore@128 → Salem@333 → Coimbatore | 498 | T+2 06:00 | ₹6.00 / ₹1.00 | 3,000 / 3,000 / 2,000 | published |
| rte_s1 | sree | Coimbatore → Tiruppur@52 → Salem@168 → Vellore@372 → Chennai | 500 | T+1 07:00 | ₹8.50 / ₹1.20 | 5,000 / 1,500 / 1,500 | published |
| rte_k1 | kavin | Coimbatore → Erode@102 → Salem@167 → Kanchipuram@447 → Chennai | 520 | T+1 21:30 | ₹8.75 / ₹1.10 | 7,000 / 3,000 / 3,000 | published |
| rte_m1 | murugan | Coimbatore → Salem@165 → Chennai | 498 | T+1 09:00 | ₹9.00 / ₹1.00 | 1,500 / 400 / 400 | published (filtered: capacity) |
| rte_v1 | velan | Coimbatore → Salem@165 → Chennai | 498 | T+3 08:00 | ₹8.00 / ₹1.00 | 3,000 / 2,500 / 2,500 | published (filtered: date) |
| rte_sl1 | selvam | Coimbatore → Bengaluru | 365 | T+1 10:00 | ₹9.00 / ₹1.00 | 5,000 / 2,000 / 2,000 | published (filtered: destination) |
| rte_h1 | ravi · veh_raj | Coimbatore → Salem → Vellore → Chennai | 498 | T−3 08:00 | ₹12 / ₹0.50 | 3,000 / 3,000 / — | completed |
| rte_h2 | ravi · veh_raj | Chennai → Vellore → Salem → Coimbatore | 498 | T−6 06:00 | ₹12 / ₹0.50 | 3,000 / 3,000 / — | completed |
Seed routes store explicit km (LEG_KM is only for driver-created routes). Default demo search (seeded Arjun's dashboard prefill): Coimbatore → Chennai, 500 kg, pickup **T+1** → exactly Raj ₹4,850 · Sree ₹5,200 · Kavin ₹5,450 (`excludedForCapacity` = 1). H1/H2 dates clamp to ≥ 1st of T's month (always "this month"); a clamped instant later than now becomes now − 1 min.

**11.5 Bookings** (transport + fee = total; all paid by UPI in demo)
| id | customer | route | segment, kg | transport | fee | total | status / key timestamps (IST) |
|---|---|---|---|---|---|---|---|
| TAKI874523 | Arjun | r0 | Coimbatore→Chennai 498, 500 | 4,500 | 350 | 4,850 | in_transit · paid T−1 20:40 · confirmed T 09:12 · picked up T 11:30 · in transit T 11:45 · expected out-for-delivery T 19:00 |
| TAKI874611 | Lakshmi | r1 | Coimbatore→Chennai 498, 600 | 4,653 | 500 | 5,153 | confirmed |
| TAKI874608 | Priya | r1 | Coimbatore→Vellore 370, 400 | 3,387 | 350 | 3,737 | confirmed |
| TAKI874640 | Arjun | r1 | Coimbatore→Chennai 498, 300 | 4,194 | 350 | 4,544 | awaiting_driver (newest request) |
| TAKI874636 | Meera | r1 | Salem→Chennai 333, 1,000 | 4,028 | 500 | 4,528 | awaiting_driver |
| TAKI874631 | Karthik | r1 | Coimbatore→Vellore 370, 1,200 | 4,611 | 750 | 5,361 | awaiting_driver (overbook demo) |
| TAKI874627 | Senthil | r2 | Chennai→Salem 333, 450 | 2,448 | 350 | 2,798 | awaiting_driver |
| TAKI874622 | Divya | r2 | Vellore→Coimbatore 370, 800 | 3,020 | 500 | 3,520 | awaiting_driver |
| TAKI874604 | Anand | r2 | Chennai→Coimbatore 498, 1,000 | 3,988 | 500 | 4,488 | confirmed |
| TAKI874391 | Arjun | h1 | Coimbatore→Chennai 498, 500 | 6,226 | 350 | 6,576 | delivered T−3 20:05 |
| TAKI874394 | Gopal | h1 | Salem→Chennai 333, 600 | 4,296 | 500 | 4,796 | delivered T−3 19:10 |
| TAKI874397 | Fathima | h1 | Vellore→Chennai 128, 1,260 | 2,166 | 750 | 2,916 | delivered T−3 19:35 |
| TAKI874362 | Suresh | h2 | Chennai→Coimbatore 498, 800 | 6,376 | 500 | 6,876 | delivered T−6 15:40 |
| TAKI874365 | Kalpana | h2 | Chennai→Salem 333, 1,000 | 4,496 | 500 | 4,996 | delivered T−6 12:10 |
| TAKI874368 | Imran | h2 | Vellore→Coimbatore 370, 1,000 | 4,940 | 500 | 5,440 | delivered T−6 15:05 |
Requests created T−1 (r1/r2) in id order; list sorts newest first → Arjun K. ₹4,194, Meera S. ₹4,028, Karthik R., Senthil P., Divya M. Capacity check r1: 2,000 − Arjun 300 − Meera 1,000 = 700 < Karthik 1,200 → Accept disabled.

**11.6 Earnings (drv_ravi)** — `EarningEntry` for each of the 6 delivered bookings (credited at delivery time): H1 6,226 + 4,296 + 2,166 = 12,688; H2 6,376 + 4,496 + 4,940 = 15,812 → **this month ₹28,500**; Recent Settlements newest first: TAKI874391 Coimbatore → Chennai ₹6,226 Paid.
`ArchivedEarningsMonth` (M−n = n months before T's month): M−1 ₹25,400 (18 deliveries, 3 routes) · M−2 ₹30,100 (24, 3) · M−3 ₹34,800 (27, 4) · M−4 ₹36,200 (26, 3) · M−5 ₹31,200 (23, 3).
`Payout` (completed, demo, "HDFC Bank ••••4321", 1st of month 10:00 IST): M−4 ₹31,200 · M−3 ₹36,200 · M−2 ₹34,800 · M−1 ₹30,100 · M0 ₹25,400 → Σ ₹1,57,700.
Derived checks: total = 28,500 + 25,400 + 1,32,300 = **₹1,86,200**; available = 1,86,200 − 1,57,700 = **₹28,500**; change = round(3,100 / 25,400 × 100) = **+12%**; deliveries = 6 + 118 = 124 (= ratingCount); completedTrips = 2 routes + 16 archived = **18**; activeRoutes = r0, r1, r2 = **03**; pendingRequests = **05**; next departing route (r1, T+1 08:00) available = **2,000 kg**.

**11.7 Notifications**: Arjun — "Your shipment TAKI874523 is in transit" (T 11:45, unread), "Ravi (Raj Transport) picked up TAKI874523" (T 11:30). Ravi — "New booking request from Arjun K." (unread), "New booking request from Meera S." (unread), "₹25,400 payout completed" (M0 1st, read).
