import { BookingIdParams, CancelBookingBody } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { cancelBooking } from "@/server/modules/customer/bookings";

/** POST /api/customer/bookings/[id]/cancel — before pickup only (409 invalid_transition afterwards). */
export const POST = handler({ auth: "customer", params: BookingIdParams, body: CancelBookingBody }, ({ session, params, body, now }) =>
  cancelBooking(session, params.bookingId, body.reason, now),
);
