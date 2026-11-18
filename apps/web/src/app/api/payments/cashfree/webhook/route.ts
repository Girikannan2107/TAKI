import { handler } from "@/server/http/handler";
import { payments } from "@/server/payments/service";

/**
 * POST /api/payments/cashfree/webhook — Cashfree notifications (path configured in the gateway
 * dashboard). Raw-body HMAC + timestamp check, dedupe on the event key, then the single
 * confirmation path. 401 invalid_signature / stale_timestamp; 501 when Cashfree is not configured.
 */
export const POST = handler({ auth: "public", csrf: false }, ({ req, now }) => payments.handleCashfreeWebhook(req, now));
