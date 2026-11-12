/**
 * TAKI Travel domain types — implemented verbatim from docs/planning/data-contract.md §2.
 * Framework-free: no React/Next/browser imports (shared with a future React Native app).
 */
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
  paymentDueAt?: IsoDateTime;                                    // set on partner acceptance; unpaid hold released after it
  pickupOtp?: string; deliveryOtp?: string;                      // issued on payment; partner must enter them (6 digits)
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
