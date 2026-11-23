/** Payments API types (contract §9). */

import type { BookingStatus, IsoDateTime } from "@/lib/domain/model";

/**
 * v3 (FastAPI E42). `cashfree`: open Cashfree JS checkout with `paymentSessionId` in `mode`.
 * `dev`: local / e2e TEST gateway only (PAYMENT_PROVIDER=dev, refused in production): the UI must label it
 * with `label` ("Test payment") and open `url` (our own /customer/payment/dev-gateway page).
 */
export type PaymentCheckout =
  | { kind: "dev"; mode?: "test"; label?: string; url: string; devToken?: string; orderId?: string }
  | { kind: "cashfree"; mode: "sandbox" | "production"; paymentSessionId: string; orderId: string };

export interface CreatePaymentOrderResponse {
  paymentId: string;
  provider: "dev" | "cashfree";
  amountRupees: number;
  expiresAt: IsoDateTime;
  checkout: PaymentCheckout;
  /** true when an existing open payment was returned instead of creating a new one. */
  reused: boolean;
  /** v3: true for the dev test gateway (no money moves). */
  testPayment?: boolean;
}

export type PublicPaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refund_pending" | "refunded" | "refund_failed";

export interface PaymentStatusResponse {
  paymentId: string;
  bookingId: string;
  status: PublicPaymentStatus;
  bookingStatus: BookingStatus;
  amountRupees: number;
  provider: "dev" | "cashfree";
  methodLabel: string | null;
  failureReason: string | null;
  /** v3 */
  bookingState?: BookingStateDTO | null;
  refund?: { status: "pending" | "succeeded" | "failed"; amountRupees: number; completedAt: IsoDateTime | null } | null;
  /** v3: dev test gateway payment (no money moved). */
  testPayment?: boolean;
}

/** v3 booking state (attached to booking DTOs and payment status). */
export interface BookingStateDTO {
  approvalStatus: "pending" | "accepted" | "rejected" | "expired" | "withdrawn";
  paymentStatus: "not_due" | "due" | "processing" | "paid" | "failed" | "expired" | "voided" | "refund_pending" | "refunded" | "refund_failed";
  reservationStatus: "none" | "held" | "committed" | "released" | "consumed";
  fulfilmentStatus: "not_started" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "pickup_refused";
  closure: { kind: "rejected" | "cancelled"; reason: string | null; note?: string | null; at: IsoDateTime; byRole: string } | null;
}
