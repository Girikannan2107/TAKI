import { z } from "zod";
import { RejectBookingBody } from "@/lib/api/contracts/agency";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { rejectBooking } from "@/server/modules/agency/bookings";

/** POST /api/agency/bookings/[bookingId]/reject { reason } → AgencyBookingDTO · 409 */
export const POST = handler({ auth: "agency", params: z.object({ bookingId: BookingIdSchema }), body: RejectBookingBody }, ({ session, params, body, now }) =>
  rejectBooking(session, params.bookingId, body.reason, now),
);
