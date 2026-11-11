import { isFreshTimestamp, jsonResponse, notConfigured, notImplemented, readCashfreeConfig, verifyWebhookSignature } from "../_lib/cashfree-server";

/**
 * POST /api/payments/cashfree/webhook — Cashfree payment notifications.
 *
 *   - not configured                → 501 { error: "payments_not_configured" }
 *   - missing / invalid signature   → 401 { error: "invalid_signature" }
 *   - stale timestamp (replay)      → 401 { error: "stale_timestamp" }
 *   - valid signature               → 501 { error: "not_implemented" } (processing not built yet)
 */
export async function POST(request: Request): Promise<Response> {
  const config = readCashfreeConfig();
  if (!config) return notConfigured();

  // Read the RAW body: the signature covers the exact bytes, so never re-serialise parsed JSON.
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");

  if (!signature || !timestamp) return jsonResponse({ error: "invalid_signature" }, 401);
  if (!verifyWebhookSignature({ timestamp, rawBody, signature, secret: config.secretKey }))
    return jsonResponse({ error: "invalid_signature" }, 401);
  if (!isFreshTimestamp(timestamp)) return jsonResponse({ error: "stale_timestamp" }, 401);

  // TODO(live payments): real flow — IDEMPOTENT processing
  //  1. Parse `rawBody` as JSON only after the signature check passed.
  //  2. Dedupe on the event id (or `order_id` + event type): a replayed / duplicate event returns 200
  //     without side effects.
  //  3. Load the stored payment by `data.order.order_id`; ignore unknown orders (200, logged without PII).
  //  4. PAYMENT_SUCCESS_WEBHOOK: check `order_amount` against the booking's server-side total, then in one
  //     transaction mark the payment `succeeded` and move the booking `pending_payment → awaiting_driver`
  //     (state machine guards against applying it twice). PAYMENT_FAILED_WEBHOOK: mark `failed`.
  //  5. Respond 200 quickly; never echo the payload, secrets or signature in logs or responses.
  return notImplemented();
}
