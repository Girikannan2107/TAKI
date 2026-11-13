/**
 * Booking state machine (data-contract.md §4). Pure: returns a new Booking.
 * Business guards (capacity, ownership, departure) live in commands.ts; this
 * module only enforces which transitions exist, plus idempotency.
 */
import type { Booking, BookingRequestStatus, BookingStatus, BookingStatusEvent, IsoDateTime } from "../types";

export type BookingEvent =
  | "requestBooking"
  | "paymentSucceeded"
  | "paymentFailed"
  | "retryPayment"
  | "paymentExpired"
  | "abandon"
  | "accept"
  | "decline"
  | "cancel"
  | "routeDeparted"
  | "markPickedUp"
  | "startTransit"
  | "markOutForDelivery"
  | "markDelivered";

/**
 * event → (from statuses) → target.
 * Flow: draft → awaiting_driver (request sent, nothing paid) → partner accepts → pending_payment
 * (final price locked, capacity held) → payment confirmed → confirmed → pickup (OTP) → … → delivered (OTP).
 */
const TRANSITIONS: Record<BookingEvent, { from: BookingStatus[]; to: BookingStatus }> = {
  requestBooking: { from: ["draft"], to: "awaiting_driver" },
  accept: { from: ["awaiting_driver"], to: "pending_payment" },
  paymentSucceeded: { from: ["pending_payment"], to: "confirmed" },
  paymentFailed: { from: ["pending_payment"], to: "payment_failed" },
  retryPayment: { from: ["payment_failed"], to: "pending_payment" },
  paymentExpired: { from: ["pending_payment", "payment_failed"], to: "cancelled" },
  abandon: { from: ["draft"], to: "cancelled" },
  decline: { from: ["awaiting_driver"], to: "declined" },
  cancel: { from: ["draft", "awaiting_driver", "pending_payment", "payment_failed", "confirmed"], to: "cancelled" },
  routeDeparted: { from: ["awaiting_driver"], to: "declined" },
  markPickedUp: { from: ["confirmed"], to: "picked_up" },
  startTransit: { from: ["picked_up"], to: "in_transit" },
  markOutForDelivery: { from: ["in_transit"], to: "out_for_delivery" },
  markDelivered: { from: ["out_for_delivery"], to: "delivered" },
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: BookingStatus,
    public readonly event: BookingEvent,
  ) {
    super(`Cannot ${event} a booking that is ${from.replace(/_/g, " ")}.`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(status: BookingStatus, event: BookingEvent): boolean {
  return TRANSITIONS[event].from.includes(status);
}

export function targetOf(event: BookingEvent): BookingStatus {
  return TRANSITIONS[event].to;
}

export interface TransitionContext {
  at: IsoDateTime;
  by: BookingStatusEvent["by"];
  note?: string;
}

/**
 * Apply `event`. If the booking is already in the event's target state the call
 * is a no-op (idempotent: double-tap Accept never double-applies). Throws
 * InvalidTransitionError otherwise.
 */
export function transition(booking: Booking, event: BookingEvent, ctx: TransitionContext): Booking {
  const { to, from } = TRANSITIONS[event];
  if (booking.status === to && !from.includes(booking.status)) return booking;
  if (!from.includes(booking.status)) throw new InvalidTransitionError(booking.status, event);
  const evt: BookingStatusEvent = { status: to, at: ctx.at, by: ctx.by, ...(ctx.note ? { note: ctx.note } : {}) };
  return { ...booking, status: to, statusHistory: [...booking.statusHistory, evt], updatedAt: ctx.at };
}

/** Driver-facing request status derived from the booking (never stored). */
export function requestStatusOf(b: Booking): BookingRequestStatus | null {
  switch (b.status) {
    case "awaiting_driver":
      return "pending";
    case "pending_payment":
    case "payment_failed":
    case "confirmed":
    case "picked_up":
    case "in_transit":
    case "out_for_delivery":
    case "delivered":
      return "accepted";
    case "declined":
      return "declined";
    case "cancelled":
      return b.statusHistory.some((e) => e.status === "awaiting_driver") ? "withdrawn" : null;
    default:
      return null;
  }
}

/** Statuses that hold route capacity (reserved when the partner accepts, before payment). */
export const CAPACITY_HOLDING: readonly BookingStatus[] = ["pending_payment", "payment_failed", "confirmed", "picked_up", "in_transit", "out_for_delivery"];

/** Statuses a driver can see (once the customer has sent the request). */
export function isVisibleToDriver(s: BookingStatus): boolean {
  return s !== "draft";
}

/** Customer shipment groupings. */
export function shipmentGroup(s: BookingStatus): "active" | "completed" | "cancelled" {
  if (s === "delivered") return "completed";
  if (s === "declined" || s === "cancelled") return "cancelled";
  return "active";
}

/** Timestamp of the first event that reached `status`, if any. */
export function reachedAt(b: Booking, status: BookingStatus): IsoDateTime | undefined {
  return b.statusHistory.find((e) => e.status === status)?.at;
}
