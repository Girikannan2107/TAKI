import { CreatePaymentOrderBody } from "@/lib/api/contracts/payments";
import { created, handler, json } from "@/server/http/handler";
import { requireIdempotencyKey } from "@/server/http/idempotency";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { payments } from "@/server/payments/service";

/**
 * POST /api/payments/orders { bookingId } + Idempotency-Key — create (201) or reuse (200) the open
 * payment for an accepted booking. The amount always comes from the booking's server-side price.
 */
export const POST = handler(
  {
    auth: "customer",
    body: CreatePaymentOrderBody,
    rateLimit: { rule: RATE_LIMITS.paymentCreate, bucket: ({ session }) => `payment:create:user:${session?.userId ?? "anon"}` },
  },
  async ({ req, session, body, now }) => {
    const order = await payments.createOrder({ now, actor: session }, body.bookingId, requireIdempotencyKey(req));
    return order.reused ? json(order, 200) : created(order);
  },
);
