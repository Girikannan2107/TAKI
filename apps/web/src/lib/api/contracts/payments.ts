/** Payments API contract (P2 §8.7). Isomorphic. */
import { z } from "zod";
import type { BookingStatus, IsoDateTime } from "@/lib/domain/model";
import { BookingIdSchema, IdSchema } from "./common";

export const CreatePaymentOrderBody = z.object({ bookingId: BookingIdSchema }); // + Idempotency-Key header (required)
export const DevConfirmBody = z.object({
  paymentId: IdSchema("pay"),
  outcome: z.enum(["success", "failure"]),
  devToken: z.string().min(16).max(128),
});
export const PaymentIdParams = z.object({ paymentId: IdSchema("pay") });

export type PaymentCheckout =
  | { kind: "dev"; url: string }
  | { kind: "cashfree"; mode: "sandbox" | "production"; paymentSessionId: string; orderId: string };

export interface CreatePaymentOrderResponse {
  paymentId: string;
  provider: "dev" | "cashfree";
  amountRupees: number;
  expiresAt: IsoDateTime;
  checkout: PaymentCheckout;
  /** true when an existing open payment was returned instead of creating a new one. */
  reused: boolean;
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
}

/** Dev gateway page data: GET /api/payments/[id] also serves it (owner only). */
export interface DevGatewayInfo {
  paymentId: string;
  bookingId: string;
  amountRupees: number;
  expiresAt: IsoDateTime;
}
