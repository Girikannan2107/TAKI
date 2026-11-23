/**
 * Browser client for the payments endpoints (FastAPI E42–E46). Nothing here can mark a payment paid: the
 * server confirms through the Cashfree webhook, the explicit verify (E44, which asks Cashfree), or — local /
 * e2e only — the dev TEST gateway's explicit Approve.
 */
import { http } from "../http";
import type { Page } from "../contracts/common";
import type { PaymentHistoryItem } from "../contracts/customer";
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "../contracts/payments";

const enc = encodeURIComponent;

export const paymentsApi = {
  /** E42 POST /payments/orders — 201 new / 200 reused. Pass a stable key per "Pay" attempt. */
  createOrder: (bookingId: string, idempotencyKey: string) => http.post<CreatePaymentOrderResponse>("/api/v1/payments/orders", { bookingId }, { idempotencyKey }),
  /** E43 GET /payments/{id} — stored status, no gateway call (poll this). */
  status: (paymentId: string, signal?: AbortSignal) => http.get<PaymentStatusResponse>(`/api/v1/payments/${enc(paymentId)}`, { signal }),
  /** E44 POST /payments/{id}/verify — server asks Cashfree, then confirms. Used by the return page. */
  verify: (paymentId: string) => http.post<PaymentStatusResponse>(`/api/v1/payments/${enc(paymentId)}/verify`),
  /** E46 GET /payments/history — every attempt, newest first. */
  history: (q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<PaymentHistoryItem>>("/api/v1/payments/history", { query: q, signal }),
  /** Dev TEST gateway page only (PAYMENT_PROVIDER=dev, development/test): explicit Approve / Decline. */
  devConfirm: (body: { paymentId: string; outcome: "success" | "failure"; devToken: string }) =>
    http.post<PaymentStatusResponse>("/api/v1/payments/dev/confirm", body),
};
