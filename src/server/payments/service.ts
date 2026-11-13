import "server-only";
/**
 * Payment service (P2 §9). The amount ALWAYS comes from booking.pricing.totalPayable.
 * Nothing on the client can mark a payment paid: only the webhook, the server-side verify
 * (GET /api/payments/[id]) and the dev gateway's explicit Approve call `confirmPayment`.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "@/lib/api/contracts/payments";
import type { PaymentDoc } from "../db/schema";
import type { Ctx } from "../core/context";

export interface ConfirmInput {
  source: "webhook" | "verify" | "dev_confirm";
  status: "paid" | "failed" | "pending" | "expired";
  amountPaise: number | null;
  providerPaymentId: string | null;
  methodLabel: string | null;
  providerStatus: string;
}

const notImplemented = (): never => {
  throw new DomainError("not_implemented");
};

export const payments = {
  /** POST /api/payments/orders — create or reuse the open payment for a booking. */
  async createOrder(_ctx: Ctx, _bookingId: string, _idempotencyKey: string): Promise<CreatePaymentOrderResponse> {
    return notImplemented();
  },
  /** GET /api/payments/[id] — owner only; when pending, verifies with the provider. */
  async getStatus(_ctx: Ctx, _paymentId: string): Promise<PaymentStatusResponse> {
    return notImplemented();
  },
  /** POST /api/payments/dev/confirm — dev gateway Approve/Decline (404 unless dev mode). */
  async devConfirm(_ctx: Ctx, _i: { paymentId: string; outcome: "success" | "failure"; devToken: string }): Promise<PaymentStatusResponse> {
    return notImplemented();
  },
  /** POST /api/payments/cashfree/webhook — raw-body signature check, dedupe, confirm. */
  async handleCashfreeWebhook(_req: Request, _now: Date): Promise<Response> {
    return notImplemented();
  },
  /** The single confirmation path (idempotent; late/duplicate payments are refunded). */
  async confirmPayment(_paymentId: string, _input: ConfirmInput, _now: Date): Promise<PaymentDoc> {
    return notImplemented();
  },
};
