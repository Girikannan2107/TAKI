import { DevConfirmBody } from "@/lib/api/contracts/payments";
import { handler } from "@/server/http/handler";
import { payments } from "@/server/payments/service";

/**
 * POST /api/payments/dev/confirm { paymentId, outcome, devToken } — the dev gateway's explicit
 * Approve / Decline step. 404 unless PAYMENT_PROVIDER=dev outside production; 403 on a bad token.
 */
export const POST = handler({ auth: "customer", body: DevConfirmBody }, ({ session, body, now }) => payments.devConfirm({ now, actor: session }, body));
