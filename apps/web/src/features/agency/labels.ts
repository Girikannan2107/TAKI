/** Display labels for the agency screens (D2). */
import type { BadgeTone } from "@/components/ui";
import type { BodyType, BookingStatus, GoodsCategory, PaymentStatus, SpecialHandling, TrackingEventType, TripStatus, VerificationStatus } from "@/lib/domain/model";
import { BODY_TYPES, GOODS_CATEGORIES, SPECIAL_HANDLING, VEHICLE_CLASSES } from "@/lib/domain/model";

export const GOODS_LABEL: Record<GoodsCategory, string> = {
  general_goods: "General goods",
  agriculture: "Agriculture",
  construction: "Construction",
  industrial: "Industrial",
  electronics: "Electronics",
  furniture: "Furniture",
  textiles: "Textiles",
  perishables: "Perishables",
  other: "Other",
};

export const HANDLING_LABEL: Record<SpecialHandling, string> = {
  fragile: "Fragile",
  keep_dry: "Keep dry",
  this_side_up: "This side up",
  temperature_sensitive: "Temperature-controlled",
};

export const BODY_TYPE_LABEL: Record<BodyType, string> = { open: "Open", tarpaulin: "Tarpaulin", closed: "Closed", container: "Container" };

export const GOODS_OPTIONS = GOODS_CATEGORIES.map((g) => ({ value: g, label: GOODS_LABEL[g] }));
export const HANDLING_OPTIONS = SPECIAL_HANDLING.map((h) => ({ value: h, label: HANDLING_LABEL[h] }));
export const BODY_TYPE_OPTIONS = BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABEL[b] }));
export const VEHICLE_CLASS_OPTIONS = VEHICLE_CLASSES.map((c) => ({ value: c, label: c }));

export const TRIP_STATUS: Record<TripStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Upcoming", tone: "success" },
  in_progress: { label: "On the road", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  awaiting_agency: { label: "Awaiting your response", tone: "attention" },
  pending_payment: { label: "Accepted · awaiting payment", tone: "warning" },
  payment_failed: { label: "Payment failed · awaiting retry", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  picked_up: { label: "Picked up", tone: "info" },
  in_transit: { label: "In transit", tone: "info" },
  out_for_delivery: { label: "Out for delivery", tone: "info" },
  delivered: { label: "Delivered", tone: "paid" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  created: { label: "Started", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  succeeded: { label: "Paid", tone: "paid" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refund_pending: { label: "Refund pending", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  refund_failed: { label: "Refund failed", tone: "danger" },
};

export const EARNING_STATUS: Record<"pending" | "settled" | "on_hold", { label: string; tone: BadgeTone }> = {
  pending: { label: "Settlement pending", tone: "warning" },
  settled: { label: "Settled", tone: "paid" },
  on_hold: { label: "On hold", tone: "danger" },
};

export const VERIFICATION: Record<VerificationStatus, { label: string; tone: BadgeTone }> = {
  not_submitted: { label: "Documents needed", tone: "attention" },
  pending: { label: "Verification pending", tone: "attention" },
  suspended: { label: "Suspended", tone: "danger" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Verification rejected", tone: "danger" },
};

export const TIMELINE_LABEL: Record<TrackingEventType, string> = {
  requested: "Booking requested",
  accepted: "Accepted by you",
  rejected: "Rejected",
  payment_succeeded: "Payment received",
  payment_failed: "Payment failed",
  confirmed: "Booking confirmed",
  cancelled: "Cancelled",
  picked_up: "Picked up",
  in_transit: "In transit",
  checkpoint_arrived: "Reached checkpoint",
  checkpoint_departed: "Left checkpoint",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_proof_added: "Delivery proof added",
  remark: "Driver remark",
};

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}
