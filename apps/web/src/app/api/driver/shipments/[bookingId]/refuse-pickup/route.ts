import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { RefusePickupBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { refusePickup } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/refuse-pickup — e.g. prohibited goods; full refund. */
export const POST = handler(
  { auth: "driver", body: RefusePickupBody, params: z.object({ bookingId: BookingIdSchema }) },
  ({ session, params, body, now }) => refusePickup(session, params.bookingId, body.reason, now),
);
