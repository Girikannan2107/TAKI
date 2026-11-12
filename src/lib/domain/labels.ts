/** User-facing labels (data-contract.md §3). */
import type { BookingStatus, CargoType, OfferBadge, PaymentMethod, PaymentStatus, PayoutStatus, RouteStatus } from "./types";

const CUSTOMER_STATUS: Record<BookingStatus, string> = {
  draft: "Request not sent",
  pending_payment: "Accepted · Payment pending",
  payment_failed: "Payment failed",
  awaiting_driver: "Awaiting driver confirmation",
  confirmed: "Booking Confirmed",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  declined: "Declined by driver",
  cancelled: "Cancelled",
};

const DRIVER_STATUS: Record<BookingStatus, string> = {
  draft: "—",
  pending_payment: "Accepted · awaiting payment",
  payment_failed: "Accepted · awaiting payment",
  awaiting_driver: "New request",
  confirmed: "Paid · awaiting pickup",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  declined: "Declined",
  cancelled: "Cancelled by customer",
};

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

export function customerStatusLabel(s: BookingStatus): string {
  return CUSTOMER_STATUS[s];
}
export function driverStatusLabel(s: BookingStatus): string {
  return DRIVER_STATUS[s];
}
export function statusTone(s: BookingStatus): StatusTone {
  switch (s) {
    case "delivered":
    case "confirmed":
      return "success";
    case "picked_up":
    case "in_transit":
    case "out_for_delivery":
      return "info";
    case "awaiting_driver":
    case "draft":
    case "pending_payment":
      return "warning";
    case "payment_failed":
    case "declined":
      return "danger";
    default:
      return "neutral";
  }
}

export const BADGE_LABEL: Record<OfferBadge, string> = {
  best_price: "Best Price",
  top_rated: "Top Rated",
  more_capacity: "More Capacity",
};
export function badgeLabel(b: OfferBadge): string {
  return BADGE_LABEL[b];
}

export const CARGO_LABEL: Record<CargoType, string> = {
  general_goods: "General goods",
  agriculture: "Agriculture",
  construction: "Construction",
  industrial: "Industrial",
  other: "Other",
};
export function cargoLabel(c: CargoType): string {
  return CARGO_LABEL[c];
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: "UPI (GPay, PhonePe, Paytm)",
  card: "Credit / Debit Card",
  netbanking: "Net Banking",
};
export function paymentMethodLabel(m: PaymentMethod): string {
  return PAYMENT_METHOD_LABEL[m];
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  initiated: "Processing",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  draft: "Draft",
  published: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Tracking timeline steps shown to customers (in order). */
export const TIMELINE_STEPS: ReadonlyArray<{ status: BookingStatus; label: string }> = [
  { status: "confirmed", label: "Booking Confirmed" },
  { status: "picked_up", label: "Picked Up" },
  { status: "in_transit", label: "In Transit" },
  { status: "out_for_delivery", label: "Out for Delivery" },
  { status: "delivered", label: "Delivered" },
];
