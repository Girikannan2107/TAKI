import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { payments } from "@/server/payments/service";

/** Legacy path kept for one release: GET ?orderId=pay_… delegates to GET /api/payments/[paymentId]. */
export const GET = handler({ auth: "customer", query: z.object({ orderId: IdSchema("pay") }) }, ({ session, query, now }) =>
  payments.getStatus({ now, actor: session }, query.orderId),
);
