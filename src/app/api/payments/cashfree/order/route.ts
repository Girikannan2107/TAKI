import { z } from "zod";
import { BookingIdSchema, IdempotencyKeyHeader } from "@/lib/api/contracts/common";
import { created, handler, json } from "@/server/http/handler";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { payments } from "@/server/payments/service";

/**
 * Legacy path kept for one release: delegates to POST /api/payments/orders.
 * Body `{ bookingId, idempotencyKey }`; any amount field is ignored (never trusted).
 */
const Body = z.object({ bookingId: BookingIdSchema, idempotencyKey: IdempotencyKeyHeader });

export const POST = handler(
  {
    auth: "customer",
    body: Body,
    rateLimit: { rule: RATE_LIMITS.paymentCreate, bucket: ({ session }) => `payment:create:user:${session?.userId ?? "anon"}` },
  },
  async ({ session, body, now }) => {
    const order = await payments.createOrder({ now, actor: session }, body.bookingId, body.idempotencyKey);
    return order.reused ? json(order, 200) : created(order);
  },
);
