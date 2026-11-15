/**
 * TAKI v2 shared domain types (P2 §4.1, §4.3, §5). Framework-free and isomorphic:
 * imported by server code, API contracts and UI alike.
 *
 * The legacy Phase 1 types still live in `./types.ts` (used by the demo store until
 * the UI migrates). Names that clash with legacy ones (BookingStatus, PaymentStatus,
 * CancelReason, NotificationKind) are exported from HERE; import v2 types from
 * `@/lib/domain/model`.
 */
import type { BookingId, Id, IsoDate, IsoDateTime, Mobile, Paise, Rupees, VehicleClass, VehicleImageKey, VehicleModelId } from "./types";

export type { BookingId, Id, IsoDate, IsoDateTime, Mobile, Paise, Rupees, VehicleClass, VehicleImageKey, VehicleModelId };

// ── Identity ──────────────────────────────────────────────────────────────────
export type Role = "customer" | "agency" | "driver" | "admin";
/** Roles that can sign up / log in through the public auth pages. */
export type PublicRole = Exclude<Role, "admin">;
export const ROLES: readonly Role[] = ["customer", "agency", "driver", "admin"];
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
/** Slug from `places/districts.ts`, e.g. "coimbatore", "bengaluru-urban". */
export type DistrictId = string;
/** Hub town slug from `places/places.ts`; each belongs to exactly one district. */
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

export interface FileRef {
  fileId: Id;
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
export type VerificationStatus = "pending" | "verified" | "rejected";
export type DriverLinkStatus = "pending" | "active" | "rejected" | "removed";
export type IdentityDocumentKind = "aadhaar" | "pan" | "driving_license";

// ── Trips ─────────────────────────────────────────────────────────────────────
export type TripStatus = "draft" | "published" | "in_progress" | "completed" | "cancelled";

export interface TripCheckpoint {
  /** 0 = origin, last = destination. */
  index: number;
  placeId: PlaceId;
  placeName: string;
  districtId: DistrictId;
  districtName: string;
  state: StateCode;
  kmFromOrigin: number;
  /** null for the origin. */
  expectedArrivalAt: IsoDateTime | null;
  /** null for the destination. */
  expectedDepartureAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  actualDepartureAt: IsoDateTime | null;
}

/** One entry of `trip.holds` — the ONLY capacity ledger (P2 §6.1). `dueAt` only for unpaid holds. */
export interface CapacityHold {
  kg: number;
  kind: "unpaid" | "paid";
  dueAt: IsoDateTime | null;
}

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
export const BOOKING_STATUSES: readonly BookingStatus[] = [
  "awaiting_agency",
  "pending_payment",
  "payment_failed",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "rejected",
  "cancelled",
];
export type CustomerTab = "pending" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "rejected" | "cancelled";
export const CUSTOMER_TABS: readonly CustomerTab[] = ["pending", "confirmed", "picked_up", "in_transit", "delivered", "rejected", "cancelled"];
export type Actor = { role: Role | "system"; userId: Id | null };
export type RejectReason = "agency_rejected" | "no_response_before_departure" | "trip_cancelled";
export type CancelReason = "customer_cancelled" | "payment_window_expired" | "trip_cancelled" | "pickup_refused";

export interface PricingLine {
  code: "distance" | "weight" | "handling" | "service_fee";
  label: string;
  amount: Rupees;
}
export interface PricingBreakdownV2 {
  pricingVersion: 2;
  distanceKm: number;
  weightKg: number;
  ratePerKmPaise: Paise;
  ratePerKgPaise: Paise;
  distanceCharge: Rupees;
  weightCharge: Rupees;
  /** Agency gross = distanceCharge + weightCharge. */
  transportationCharge: Rupees;
  handlingFee: Rupees;
  serviceFee: Rupees;
  totalPayable: Rupees;
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

// ── Payments ─────────────────────────────────────────────────────────────────
export type PaymentProvider = "dev" | "cashfree";
export type PaymentProviderEnv = "dev" | "sandbox" | "production";
export type PaymentStatus =
  | "created"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "refund_failed";

// ── Earnings ─────────────────────────────────────────────────────────────────
export type EarningStatus = "pending" | "settled" | "on_hold";

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

// ── Files ─────────────────────────────────────────────────────────────────────
export type FileKind = "aadhaar" | "pan" | "driving_license" | "profile_photo" | "vehicle_photo" | "delivery_proof";
export type FileOwnerType = "customer" | "agency" | "driver" | "vehicle" | "booking";
export type FileContentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
