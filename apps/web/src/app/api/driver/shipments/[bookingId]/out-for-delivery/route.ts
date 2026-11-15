import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { CheckpointActionBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { outForDelivery } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/out-for-delivery — manual fallback (normally automatic on arrival). */
export const POST = handler(
  { auth: "driver", body: CheckpointActionBody, params: z.object({ bookingId: BookingIdSchema }) },
  ({ session, params, body, now }) => outForDelivery(session, params.bookingId, body, now),
);
