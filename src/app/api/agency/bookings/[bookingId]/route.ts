import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { getBooking } from "@/server/modules/agency/bookings";

/** GET /api/agency/bookings/[bookingId] → AgencyBookingDTO (contact details gated by status) */
export const GET = handler({ auth: "agency", params: z.object({ bookingId: BookingIdSchema }) }, ({ session, params, now }) => getBooking(session, params.bookingId, now));
