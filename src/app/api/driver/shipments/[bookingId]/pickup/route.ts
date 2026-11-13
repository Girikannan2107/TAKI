import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { PickupBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { confirmPickup } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/pickup — confirm with the customer's pickup OTP. */
export const POST = handler(
  { auth: "driver", body: PickupBody, params: z.object({ bookingId: BookingIdSchema }) },
  ({ session, params, body, now }) => confirmPickup(session, params.bookingId, body, now),
);
