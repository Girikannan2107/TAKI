import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { acceptBooking } from "@/server/modules/agency/bookings";

/** POST /api/agency/bookings/[bookingId]/accept → AgencyBookingDTO · 409 insufficient_capacity / invalid_transition · 410 request_expired · 403 */
export const POST = handler({ auth: "agency", params: z.object({ bookingId: BookingIdSchema }) }, ({ session, params, now }) => acceptBooking(session, params.bookingId, now));
