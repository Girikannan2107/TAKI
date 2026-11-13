import { PaymentIdParams } from "@/lib/api/contracts/payments";
import { handler } from "@/server/http/handler";
import { payments } from "@/server/payments/service";

/**
 * GET /api/payments/[paymentId] — owner only. While pending, verifies with the provider
 * (server-side Get Order) and applies the result; dev payments only change via Approve/Decline.
 */
export const GET = handler({ auth: "customer", params: PaymentIdParams }, ({ session, params, now }) => payments.getStatus({ now, actor: session }, params.paymentId));
