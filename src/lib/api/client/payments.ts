/**
 * Browser client for D5's payments endpoints (P2 §8.7). Nothing here can mark a payment paid:
 * the server confirms through the webhook, the provider verify on GET, or the dev gateway's
 * explicit Approve.
 */
import { http } from "../http";
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "../contracts/payments";

export const paymentsApi = {
  /** POST /api/payments/orders — 201 new / 200 reused. Pass a stable key per "Pay" attempt. */
  createOrder: (bookingId: string, idempotencyKey: string) => http.post<CreatePaymentOrderResponse>("/api/payments/orders", { bookingId }, { idempotencyKey }),
  /** GET /api/payments/[id] — poll after returning from the gateway. */
  status: (paymentId: string, signal?: AbortSignal) => http.get<PaymentStatusResponse>(`/api/payments/${encodeURIComponent(paymentId)}`, { signal }),
  /** Dev gateway page only (PAYMENT_PROVIDER=dev): explicit Approve / Decline. */
  devConfirm: (body: { paymentId: string; outcome: "success" | "failure"; devToken: string }) => http.post<PaymentStatusResponse>("/api/payments/dev/confirm", body),
};
