import { isBookingId, isIdempotencyKey, jsonResponse, notConfigured, notImplemented, readCashfreeConfig } from "../_lib/cashfree-server";

/**
 * POST /api/payments/cashfree/order — create a Cashfree order for a booking.
 *
 * STUB: answers 501 until the live integration is built.
 *   - not configured → 501 { error: "payments_not_configured" }
 *   - configured     → 501 { error: "not_implemented" }
 */
export async function POST(request: Request): Promise<Response> {
  const config = readCashfreeConfig();
  if (!config) return notConfigured();

  // Accept ONLY { bookingId, idempotencyKey }. Any `amount` (or other field) in the body is ignored:
  // the price is never trusted from the client.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const { bookingId, idempotencyKey } = (body ?? {}) as Record<string, unknown>;
  if (!isBookingId(bookingId) || !isIdempotencyKey(idempotencyKey)) return jsonResponse({ error: "invalid_body" }, 400);

  // TODO(live payments): real flow
  //  1. Authenticate the caller (server session) and load the booking from the database by `bookingId`;
  //     404 unless it belongs to the caller; 409 unless its status is `pending_payment` / `payment_failed`.
  //  2. Derive the amount SERVER-SIDE from the booking's stored pricing snapshot
  //     (`booking.pricing.totalPayable`, re-checked with `domain/pricing.quote()`), currency "INR".
  //  3. Idempotency: if a payment row already exists for `idempotencyKey`, return its stored
  //     `payment_session_id` instead of creating a second order. Use the key as Cashfree `order_id`
  //     so the gateway also dedupes.
  //  4. Call Cashfree Create Order (`POST {base}/pg/orders`, base from `config.env`) with headers
  //     `x-client-id: config.appId`, `x-client-secret: config.secretKey`, `x-api-version`.
  //     Never log the secret or the request headers.
  //  5. Persist the payment as `initiated` and return ONLY `{ orderId, paymentSessionId }`.
  //  The booking is NOT marked paid here — only /verify or the signed /webhook may do that.
  void config;
  return notImplemented();
}
