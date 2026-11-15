import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { getShipment } from "@/server/modules/driver/shipments";

/** GET /api/driver/shipments/[bookingId] — action screen (contacts only while assigned and active). */
export const GET = handler({ auth: "driver", params: z.object({ bookingId: BookingIdSchema }) }, ({ session, params }) =>
  getShipment(session, params.bookingId),
);
