import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { confirmDelivery } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/deliver — multipart: otp, receivedBy?, remarks?, clientAt?, proof (1–3 photos). */
export const POST = handler(
  {
    auth: "driver",
    form: true,
    params: z.object({ bookingId: BookingIdSchema }),
    rateLimit: { rule: RATE_LIMITS.upload, bucket: ({ session }) => `upload:user:${session?.userId ?? "anon"}` },
  },
  ({ session, params, form, now }) => confirmDelivery(session, params.bookingId, form!, now),
);
