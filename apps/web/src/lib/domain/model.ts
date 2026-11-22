/**
 * Shared domain types for the web app: enums and DTO building blocks matching the FastAPI contract
 * (docs/v3/P2-api-contract.md). Types only (plus the enum value lists); no business rules live here.
 */

// ── Primitive aliases and the vehicle catalogue types ───────────────────────────
export type Id = string;
export type BookingId = string;         // "TAKI" + 8 digits
export type IsoDate = string;            // "YYYY-MM-DD" (IST calendar date)
export type IsoDateTime = string;        // UTC instant, "2026-11-10T06:00:00.000Z"
export type TimeOfDay = string;          // "HH:mm" 24h IST, minutes 00 or 30
export type Rupees = number;            // integer >= 0
export type Paise = number;             // integer >= 0
export type Mobile = string;
export type VehicleModelId = 'tata_ace' | 'mahindra_bolero_pickup' | 'tata_407' | 'eicher_pro' | 'ashok_leyland_ecomet';
export type VehicleClass = 'Mini Truck' | 'Pickup' | 'Light Truck' | 'Medium Truck' | 'Heavy Truck';
export type VehicleImageKey =
  | 'green_tarpaulin_truck_taki' | 'light_cargo_lorry_taki' | 'medium_cargo_truck_taki' | 'large_curtainside_lorry_taki'
  | 'heavy_freight_lorry_taki' | 'mini_delivery_truck_taki' | 'multi_axle_container_taki' | 'medium_box_truck_generic';
export interface VehicleModel { id: VehicleModelId; label: string; vehicleClass: VehicleClass; maxPayloadKg: number; imageKey: VehicleImageKey }
/** Shape of the illustrative quote on the help page (`pricing.quote`); real prices come from the API. */
export interface PricingBreakdown {
  pricingVersion: 1;
  distanceKm: number; weightKg: number;                          // segment distance actually charged
  ratePerKmPaise: Paise; ratePerKgPaise: Paise;
  distanceCharge: Rupees;                                        // roundHalfUp(distanceKm * ratePerKmPaise / 100)
  weightCharge: Rupees;                                          // roundHalfUp(weightKg * ratePerKgPaise / 100)
  transportationCharge: Rupees;                                  // distanceCharge + weightCharge
  serviceFee: Rupees;                                            // serviceFeeFor(weightKg)
  totalPayable: Rupees;                                          // transportationCharge + serviceFee
}


// ── Identity ──────────────────────────────────────────────────────────────────
export type Role = "customer" | "agency" | "driver" | "admin";
/** Roles that can sign up / log in through the public auth pages. */
export type PublicRole = Exclude<Role, "admin">;
export const PUBLIC_ROLES: readonly PublicRole[] = ["customer", "agency", "driver"];

// ── Places ────────────────────────────────────────────────────────────────────
export type StateCode = "TN" | "KL" | "KA" | "TG" | "AP";
export const STATE_CODES: readonly StateCode[] = ["TN", "KL", "KA", "TG", "AP"];
export const STATE_NAMES: Record<StateCode, string> = {
  TN: "Tamil Nadu",
  KL: "Kerala",
  KA: "Karnataka",
  TG: "Telangana",
  AP: "Andhra Pradesh",
};
/** v2 district slug (only in legacy data; v3 uses Google place ids). */
export type DistrictId = string;
/** Place id: a Google place id in v3 (`fake_*` from the local gazetteer). */
export type PlaceId = string;

export interface Address {
  line1: string;
  line2?: string;
  landmark?: string;
  districtId: DistrictId;
  districtName: string;
  state: StateCode;
  /** /^[1-9]\d{5}$/, prefix must agree with the state. */
  pincode: string;
  /** Only when the user chose "current location". */
  location?: { lat: number; lng: number };
  source: "manual" | "current_location";
}

// ── Goods & vehicles ─────────────────────────────────────────────────────────
export type GoodsCategory =
  | "general_goods"
  | "agriculture"
  | "construction"
  | "industrial"
  | "electronics"
  | "furniture"
  | "textiles"
  | "perishables"
  | "other";
export const GOODS_CATEGORIES: readonly GoodsCategory[] = [
  "general_goods",
  "agriculture",
  "construction",
  "industrial",
  "electronics",
  "furniture",
  "textiles",
  "perishables",
  "other",
];
export type PackageType = "box" | "bag" | "sack" | "crate" | "pallet" | "loose" | "other";
export const PACKAGE_TYPES: readonly PackageType[] = ["box", "bag", "sack", "crate", "pallet", "loose", "other"];
export type SpecialHandling = "fragile" | "keep_dry" | "this_side_up" | "temperature_sensitive";
export const SPECIAL_HANDLING: readonly SpecialHandling[] = ["fragile", "keep_dry", "this_side_up", "temperature_sensitive"];
export const VEHICLE_CLASSES: readonly VehicleClass[] = ["Mini Truck", "Pickup", "Light Truck", "Medium Truck", "Heavy Truck"];
export type BodyType = "open" | "tarpaulin" | "closed" | "container";
export const BODY_TYPES: readonly BodyType[] = ["open", "tarpaulin", "closed", "container"];
export type VehicleCountRange = "1-5" | "6-10" | "11-25" | "26-50" | "50+";
export const VEHICLE_COUNT_RANGES: readonly VehicleCountRange[] = ["1-5", "6-10", "11-25", "26-50", "50+"];

// ── Verification / links ─────────────────────────────────────────────────────
/** v3 adds `not_submitted` (signed up, documents not sent) and `suspended` (admin). */
export type VerificationStatus = "not_submitted" | "pending" | "verified" | "rejected" | "suspended";
export type DriverLinkStatus = "pending" | "active" | "rejected" | "removed";
export type IdentityDocumentKind = "aadhaar" | "pan" | "driving_license";

// ── Trips ─────────────────────────────────────────────────────────────────────
export type TripStatus = "draft" | "published" | "in_progress" | "completed" | "cancelled";

// ── Bookings ─────────────────────────────────────────────────────────────────
export type BookingStatus =
  | "awaiting_agency"
  | "pending_payment"
  | "payment_failed"
  | "confirmed"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "rejected"
  | "cancelled";
export type CustomerTab = "pending" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "rejected" | "cancelled";
export type RejectReason = "agency_rejected" | "no_response_before_departure" | "trip_cancelled";
export type CancelReason = "customer_cancelled" | "payment_window_expired" | "trip_cancelled" | "pickup_refused";

export interface PricingLine {
  /** v3 adds "additional" (one line per applied additional charge); v2 used "handling". */
  code: "distance" | "weight" | "handling" | "additional" | "service_fee";
  label: string;
  amount: Rupees;
}
/** Price snapshot. v3 (FastAPI) is the same shape plus `additionalCharges` / `agencyNet`; `lines` drive every breakdown (Σ = total). */
export interface PricingBreakdownV2 {
  pricingVersion: 2 | 3;
  distanceKm: number;
  weightKg: number;
  ratePerKmPaise: Paise;
  ratePerKgPaise: Paise;
  distanceCharge: Rupees;
  weightCharge: Rupees;
  /** Agency gross = distanceCharge + weightCharge. */
  transportationCharge: Rupees;
  /** Deprecated alias of `additionalCharges` (v3 keeps it for one release). */
  handlingFee: Rupees;
  /** v3: Σ applied additional charges. */
  additionalCharges?: Rupees;
  serviceFee: Rupees;
  totalPayable: Rupees;
  /** v3: what the agency earns (transport + additional charges). */
  agencyNet?: Rupees;
  lines: PricingLine[];
}

export type TrackingEventType =
  | "requested"
  | "accepted"
  | "rejected"
  | "payment_succeeded"
  | "payment_failed"
  | "confirmed"
  | "cancelled"
  | "picked_up"
  | "in_transit"
  | "checkpoint_arrived"
  | "checkpoint_departed"
  | "out_for_delivery"
  | "delivered"
  | "delivery_proof_added"
  | "remark";

export type TripEventType = "started" | "checkpoint_arrived" | "checkpoint_departed" | "completed" | "cancelled";
export type PaymentStatus =
  | "created"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "refund_failed";

// ── Notifications ────────────────────────────────────────────────────────────
export type NotificationKind =
  | "booking_requested"
  | "booking_accepted"
  | "booking_rejected"
  | "booking_expired"
  | "booking_cancelled"
  | "payment_succeeded"
  | "payment_failed"
  | "payment_refunded"
  | "shipment_assigned"
  | "pickup_confirmed"
  | "checkpoint_reached"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "review_received"
  | "trip_cancelled"
  | "trip_published"
  | "agency_verified"
  | "agency_rejected"
  | "driver_verified"
  | "driver_rejected"
  | "driver_link_requested"
  | "driver_link_decided"
  | "driver_invited"
  | "settlement_recorded";
export interface NotificationLink {
  type: "booking" | "trip" | "driver" | "profile" | "earnings";
  id: string;
}
