/**
 * Booking state machine v2 (P2 §5.1). Pure and isomorphic.
 *
 *   request → awaiting_agency ─accept→ pending_payment ⇄ payment_failed ─paid→ confirmed
 *     → picked_up → in_transit → out_for_delivery → delivered
 *   awaiting_agency ─reject / expireRequest / tripCancelled→ rejected
 *   awaiting_agency | pending_payment | payment_failed | confirmed ─cancel→ cancelled (before pickup only)
 *
 * Business guards (capacity, ownership, OTPs, time windows) live in `src/server/core/*`;
 * this module only decides which transitions exist, the customer tab and idempotency.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { Actor, BookingStatus, CustomerTab, IsoDateTime } from "./model";

export type BookingEventV2 =
  | "accept"
  | "reject"
  | "expireRequest"
  | "paymentSucceeded"
  | "retryPayment"
  | "paymentFailed"
  | "expirePayment"
  | "cancel"
  | "tripCancelled"
  | "refusePickup"
  | "pickup"
  | "startTransit"
  | "outForDelivery"
  | "deliver";

interface TransitionRule {
  from: readonly BookingStatus[];
  /** Target; a function when the target depends on the source status. */
  to: BookingStatus | ((from: BookingStatus) => BookingStatus);
}

const BEFORE_PICKUP: readonly BookingStatus[] = ["awaiting_agency", "pending_payment", "payment_failed", "confirmed"];

const RULES: Record<BookingEventV2, TransitionRule> = {
  accept: { from: ["awaiting_agency"], to: "pending_payment" },
  reject: { from: ["awaiting_agency"], to: "rejected" },
  expireRequest: { from: ["awaiting_agency"], to: "rejected" },
  paymentSucceeded: { from: ["pending_payment", "payment_failed"], to: "confirmed" },
  paymentFailed: { from: ["pending_payment"], to: "payment_failed" },
  /** Customer starts a new checkout after a failure. */
  retryPayment: { from: ["payment_failed"], to: "pending_payment" },
  expirePayment: { from: ["pending_payment", "payment_failed"], to: "cancelled" },
  cancel: { from: BEFORE_PICKUP, to: "cancelled" },
  tripCancelled: { from: BEFORE_PICKUP, to: (from) => (from === "awaiting_agency" ? "rejected" : "cancelled") },
  refusePickup: { from: ["confirmed"], to: "cancelled" },
  pickup: { from: ["confirmed"], to: "picked_up" },
  startTransit: { from: ["picked_up"], to: "in_transit" },
  outForDelivery: { from: ["in_transit"], to: "out_for_delivery" },
  deliver: { from: ["out_for_delivery"], to: "delivered" },
};

/** Statuses that own a capacity hold on the trip (P2 §6.1 invariant). */
export const HOLDING_STATUSES: readonly BookingStatus[] = [
  "pending_payment",
  "payment_failed",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
];
/** No further transitions. */
export const TERMINAL_STATUSES: readonly BookingStatus[] = ["delivered", "rejected", "cancelled"];
/** Customer may cancel (before pickup only). */
export const CANCELLABLE_STATUSES: readonly BookingStatus[] = BEFORE_PICKUP;
/** Customer may (re)start a payment. */
export const PAYABLE_STATUSES: readonly BookingStatus[] = ["pending_payment", "payment_failed"];
/** Driver can see the booking (from confirmed on). */
export const DRIVER_VISIBLE_STATUSES: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];
/** Statuses with goods physically on the vehicle or later. */
export const PICKED_UP_OR_LATER: readonly BookingStatus[] = ["picked_up", "in_transit", "out_for_delivery", "delivered"];
/** Non-terminal statuses — a shipment can have at most one booking in these. */
export const OPEN_STATUSES: readonly BookingStatus[] = [
  "awaiting_agency",
  "pending_payment",
  "payment_failed",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
];

export function isTerminal(s: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}
export function holdsCapacity(s: BookingStatus): boolean {
  return HOLDING_STATUSES.includes(s);
}
export function isBeforePickup(s: BookingStatus): boolean {
  return BEFORE_PICKUP.includes(s);
}

/** Customer "My Shipments" tab for a status (P2 §5.1 table). */
export function tabOf(s: BookingStatus): CustomerTab {
  switch (s) {
    case "awaiting_agency":
    case "pending_payment":
    case "payment_failed":
      return "pending";
    case "confirmed":
      return "confirmed";
    case "picked_up":
      return "picked_up";
    case "in_transit":
    case "out_for_delivery":
      return "in_transit";
    case "delivered":
      return "delivered";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
  }
}

/** Agency-facing request state (derived). */
export function requestStateOf(s: BookingStatus): "pending" | "accepted" | "rejected" | "cancelled" {
  if (s === "awaiting_agency") return "pending";
  if (s === "rejected") return "rejected";
  if (s === "cancelled") return "cancelled";
  return "accepted";
}

export function canApply(status: BookingStatus, event: BookingEventV2): boolean {
  return RULES[event].from.includes(status);
}

export function targetOf(event: BookingEventV2, from: BookingStatus): BookingStatus {
  const to = RULES[event].to;
  return typeof to === "function" ? to(from) : to;
}

export interface StatusHistoryEntry {
  status: BookingStatus;
  at: IsoDateTime;
  by: Actor;
  note?: string;
}

/** The minimal booking shape the machine needs (BookingDoc satisfies it). */
export interface MachineBooking {
  status: BookingStatus;
  tab: CustomerTab;
  statusHistory: StatusHistoryEntry[];
  updatedAt: IsoDateTime;
  version: number;
}

export interface TransitionInput {
  at: IsoDateTime;
  by: Actor;
  note?: string;
}

export type TransitionResult<B> = { booking: B; changed: true; from: BookingStatus } | { booking: B; changed: false; from: BookingStatus };

/**
 * Apply `event`. Idempotent: when the booking is already in a status this event can
 * produce and the event is not applicable from it, the booking is returned unchanged
 * with `changed: false` and callers must skip side effects. Otherwise throws
 * `DomainError("invalid_transition")`.
 */
export function applyEvent<B extends MachineBooking>(booking: B, event: BookingEventV2, input: TransitionInput): TransitionResult<B> {
  const rule = RULES[event];
  const from = booking.status;
  if (!rule.from.includes(from)) {
    const possibleTargets = new Set(rule.from.map((f) => targetOf(event, f)));
    if (possibleTargets.has(from)) return { booking, changed: false, from };
    throw new DomainError("invalid_transition", undefined, { details: { from, event } });
  }
  const to = targetOf(event, from);
  const entry: StatusHistoryEntry = { status: to, at: input.at, by: input.by, ...(input.note ? { note: input.note } : {}) };
  return {
    booking: {
      ...booking,
      status: to,
      tab: tabOf(to),
      statusHistory: [...booking.statusHistory, entry],
      updatedAt: input.at,
      version: booking.version + 1,
    },
    changed: true,
    from,
  };
}

/** First time the booking reached `status`, from its history. */
export function statusReachedAt(b: { statusHistory: readonly StatusHistoryEntry[] }, status: BookingStatus): IsoDateTime | null {
  return b.statusHistory.find((e) => e.status === status)?.at ?? null;
}
