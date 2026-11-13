import "server-only";
/** Payment gateway adapter interface (P2 §9). */
import type { IsoDateTime, Mobile } from "@/lib/domain/model";

export type CheckoutPayload =
  | { kind: "dev"; url: string; devToken: string }
  | { kind: "cashfree"; mode: "sandbox" | "production"; paymentSessionId: string; orderId: string };

export type GatewayEvent =
  | { type: "payment_succeeded" | "payment_failed" | "payment_dropped"; orderId: string; providerPaymentId: string | null; amountPaise: number | null; methodLabel: string | null; eventKey: string }
  | { type: "refund_status"; orderId: string; refundId: string; status: "succeeded" | "failed" | "pending"; providerRefundId: string | null; eventKey: string };

export interface OrderStatus {
  status: "paid" | "failed" | "pending" | "expired";
  amountPaise: number | null;
  providerPaymentId: string | null;
  methodLabel: string | null;
  raw: string;
}

export interface PaymentGateway {
  readonly provider: "dev" | "cashfree";
  readonly env: "dev" | "sandbox" | "production";
  createOrder(i: {
    paymentId: string;
    amountPaise: number;
    customer: { id: string; phone: Mobile; name: string };
    returnUrl: string;
    notifyUrl: string;
    expiresAt: IsoDateTime;
  }): Promise<{ checkout: CheckoutPayload; paymentSessionId?: string }>;
  fetchOrderStatus(paymentId: string): Promise<OrderStatus>;
  verifyWebhook?(req: { rawBody: string; headers: Headers; now: Date }): { ok: true; event: GatewayEvent | null } | { ok: false; reason: "invalid_signature" | "stale_timestamp" };
  refund(i: { paymentId: string; refundId: string; amountPaise: number; reason: string }): Promise<{ status: "pending" | "succeeded" | "failed"; providerRefundId: string | null }>;
  fetchRefundStatus(i: { paymentId: string; refundId: string }): Promise<"pending" | "succeeded" | "failed">;
}
