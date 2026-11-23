/** Customer-facing labels and badge tones. No React. */
import type { BadgeTone } from "@/components/ui";
import type { BodyType, BookingStatus, CustomerTab, GoodsCategory, PackageType, SpecialHandling, StateCode, VehicleClass } from "@/lib/domain/model";
import { GOODS_CATEGORIES, PACKAGE_TYPES, SPECIAL_HANDLING, STATE_CODES, STATE_NAMES, VEHICLE_CLASSES } from "@/lib/domain/model";
import type { OfferBadge, OfferSort } from "@/lib/domain/offers";

export const GOODS_LABEL: Record<GoodsCategory, string> = {
  general_goods: "General goods",
  agriculture: "Agricultural produce",
  construction: "Construction material",
  industrial: "Industrial goods",
  electronics: "Electronics",
  furniture: "Furniture",
  textiles: "Textiles",
  perishables: "Perishables",
  other: "Other",
};

export const PACKAGE_TYPE_LABEL: Record<PackageType, string> = {
  box: "Box / carton",
  bag: "Bag",
  sack: "Sack",
  crate: "Crate",
  pallet: "Pallet",
  loose: "Loose",
  other: "Other",
};

export const HANDLING_LABEL: Record<SpecialHandling, string> = {
  fragile: "Fragile",
  keep_dry: "Keep dry",
  this_side_up: "This side up",
  temperature_sensitive: "Temperature-controlled",
};

export const BODY_TYPE_LABEL: Record<BodyType, string> = {
  open: "Open body",
  tarpaulin: "Tarpaulin covered",
  closed: "Closed body",
  container: "Container",
};

export const BADGE_LABEL: Record<OfferBadge, string> = {
  best_price: "Best price",
  top_rated: "Top rated",
  more_capacity: "More capacity",
};

export const BADGE_TONE: Record<OfferBadge, BadgeTone> = {
  best_price: "success",
  top_rated: "success",
  more_capacity: "lavender",
};

export const SORT_OPTIONS: ReadonlyArray<{ value: OfferSort; label: string }> = [
  { value: "price_asc", label: "Lowest price" },
  { value: "price_desc", label: "Highest price" },
  { value: "departure_asc", label: "Earliest departure" },
  { value: "arrival_asc", label: "Earliest arrival" },
];

export const GOODS_OPTIONS = GOODS_CATEGORIES.map((g) => ({ value: g, label: GOODS_LABEL[g] }));
export const PACKAGE_OPTIONS = PACKAGE_TYPES.map((p) => ({ value: p, label: PACKAGE_TYPE_LABEL[p] }));
export const HANDLING_OPTIONS = SPECIAL_HANDLING.map((h) => ({ value: h, label: HANDLING_LABEL[h] }));
export const VEHICLE_CLASS_OPTIONS = VEHICLE_CLASSES.map((v) => ({ value: v, label: v }));
export const STATE_OPTIONS = STATE_CODES.map((s) => ({ value: s, label: STATE_NAMES[s] }));

export function isVehicleClass(v: string): v is VehicleClass {
  return (VEHICLE_CLASSES as readonly string[]).includes(v);
}
export function isGoodsCategory(v: string | null | undefined): v is GoodsCategory {
  return !!v && (GOODS_CATEGORIES as readonly string[]).includes(v);
}
export function isSpecialHandling(v: string): v is SpecialHandling {
  return (SPECIAL_HANDLING as readonly string[]).includes(v);
}
export function isStateCode(v: string | null | undefined): v is StateCode {
  return !!v && (STATE_CODES as readonly string[]).includes(v);
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  awaiting_agency: "Awaiting agency approval",
  pending_payment: "Accepted · payment due",
  payment_failed: "Payment failed",
  confirmed: "Confirmed",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  awaiting_agency: "warning",
  pending_payment: "attention",
  payment_failed: "danger",
  confirmed: "info",
  picked_up: "info",
  in_transit: "info",
  out_for_delivery: "info",
  delivered: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function bookingStatusLabel(s: BookingStatus): string {
  return STATUS_LABEL[s];
}
export function bookingStatusTone(s: BookingStatus): BadgeTone {
  return STATUS_TONE[s];
}

export const CUSTOMER_TAB_ITEMS: ReadonlyArray<{ value: CustomerTab; label: string; empty: string; hint?: string }> = [
  { value: "pending", label: "Pending", empty: "No pending bookings", hint: "Requests awaiting the agency and bookings waiting for payment appear here." },
  { value: "confirmed", label: "Confirmed", empty: "No confirmed bookings", hint: "Paid bookings waiting for pickup appear here." },
  { value: "picked_up", label: "Picked Up", empty: "Nothing picked up right now" },
  { value: "in_transit", label: "In Transit", empty: "Nothing in transit right now" },
  { value: "delivered", label: "Delivered", empty: "No deliveries yet" },
  { value: "rejected", label: "Rejected", empty: "No rejected requests" },
  { value: "cancelled", label: "Cancelled", empty: "No cancelled bookings" },
];

export function isCustomerTab(v: string | null | undefined): v is CustomerTab {
  return CUSTOMER_TAB_ITEMS.some((t) => t.value === v);
}

export const REJECT_REASON_TEXT: Record<string, string> = {
  agency_rejected: "The agency couldn't take this shipment.",
  no_response_before_departure: "The agency didn't respond before departure, so the request expired.",
  trip_cancelled: "The agency cancelled this trip.",
};

export const CANCEL_REASON_TEXT: Record<string, string> = {
  customer_cancelled: "You cancelled this booking.",
  payment_window_expired: "Payment wasn't completed in time, so the space was released.",
  trip_cancelled: "The agency cancelled this trip.",
  pickup_refused: "The driver couldn't accept the goods at pickup.",
};
