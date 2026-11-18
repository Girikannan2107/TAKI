import { BookingIdParams, ReviewBody } from "@/lib/api/contracts/customer";
import { created, handler } from "@/server/http/handler";
import { reviewBooking } from "@/server/modules/customer/bookings";

/** POST /api/customer/bookings/[id]/review — once, after delivery (409 already_reviewed). */
export const POST = handler({ auth: "customer", params: BookingIdParams, body: ReviewBody }, async ({ session, params, body, now }) =>
  created(await reviewBooking(session, params.bookingId, body, now)),
);
