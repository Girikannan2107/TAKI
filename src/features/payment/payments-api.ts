/**
 * Customer-side calls to D5's payments endpoints (P2 §8.7). Same shape as D5's
 * `src/lib/api/client/payments.ts`; switch the import there once that file lands.
 */
import { http } from "@/lib/api/http";
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "@/lib/api/contracts/payments";

export const paymentsApi = {
  createOrder: (bookingId: string, idempotencyKey: string) => http.post<CreatePaymentOrderResponse>("/api/payments/orders", { bookingId }, { idempotencyKey }),
  status: (paymentId: string, signal?: AbortSignal) => http.get<PaymentStatusResponse>(`/api/payments/${encodeURIComponent(paymentId)}`, { signal }),
  devConfirm: (body: { paymentId: string; outcome: "success" | "failure"; devToken: string }) => http.post<PaymentStatusResponse>("/api/payments/dev/confirm", body),
};
