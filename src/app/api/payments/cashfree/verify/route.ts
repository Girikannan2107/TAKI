import { jsonResponse, notConfigured, notImplemented, readCashfreeConfig } from "../_lib/cashfree-server";

/**
 * GET /api/payments/cashfree/verify?orderId=… — server-side confirmation of an order.
 *
 * STUB: answers 501 until the live integration is built.
 *   - not configured → 501 { error: "payments_not_configured" }
 *   - configured     → 501 { error: "not_implemented" }
 */
export async function GET(request: Request): Promise<Response> {
  const config = readCashfreeConfig();
  if (!config) return notConfigured();

  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(orderId)) return jsonResponse({ error: "invalid_order_id" }, 400);

  // TODO(live payments): real flow — an IDEMPOTENT lookup by orderId
  //  1. Authenticate the caller and load the stored payment by `orderId`; 404 unless it belongs to the caller.
  //  2. If it is already `succeeded` (or `failed`), return the stored record — do not call the gateway
  //     again and do not transition the booking a second time.
  //  3. Otherwise call Cashfree Get Order (`GET {base}/pg/orders/{orderId}`) with the server-side
  //     credentials; compare `order_amount` with the booking's server-side total.
  //  4. On PAID: in one transaction mark the payment `succeeded` and move the booking
  //     `pending_payment → awaiting_driver` via the booking state machine (applied once).
  //     On failure/expiry: mark `failed` and the booking `payment_failed`.
  //  5. Return `{ status: "paid" | "failed" | "pending" }` — never gateway secrets or raw responses.
  void config;
  return notImplemented();
}
