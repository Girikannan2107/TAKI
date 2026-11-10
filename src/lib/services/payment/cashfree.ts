"use client";
/**
 * Cashfree adapter — PREPARED FOR INTEGRATION, NOT ACTIVE.
 *
 * Intended live flow (see docs/backend-integration.md):
 *  1. POST /api/payments/cashfree/order { bookingId, idempotencyKey }  → server loads the booking,
 *     derives the amount from its pricing snapshot, creates a Cashfree order (secret stays server-side)
 *     and returns only `payment_session_id`.
 *  2. Client opens Cashfree Checkout (JS SDK) with that session id.
 *  3. Server verifies: GET /api/payments/cashfree/verify?orderId=… and/or a signed webhook.
 *     Only that server-side confirmation marks the booking paid (idempotent by order id).
 * Until the API routes are configured they answer 501 and this adapter refuses to proceed.
 */
import { DomainError } from "@/lib/domain/db";
import type { PayInput, PaymentAdapter } from "./types";

export const cashfreePaymentAdapter: PaymentAdapter = {
  mode: "live",
  async pay(input: PayInput) {
    const res = await fetch("/api/payments/cashfree/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookingId: input.bookingId, idempotencyKey: input.idempotencyKey }),
    });
    if (res.status === 501) throw new DomainError("payments_not_configured", "Online payments are not configured for this deployment.");
    throw new DomainError("payments_not_implemented", "Live checkout is not available in this build.");
  },
};
