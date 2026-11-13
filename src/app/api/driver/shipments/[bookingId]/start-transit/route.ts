import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { CheckpointActionBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { startTransit } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/start-transit — manual fallback (normally automatic on departure). */
export const POST = handler(
  { auth: "driver", body: CheckpointActionBody, params: z.object({ bookingId: BookingIdSchema }) },
  ({ session, params, body, now }) => startTransit(session, params.bookingId, body, now),
);
