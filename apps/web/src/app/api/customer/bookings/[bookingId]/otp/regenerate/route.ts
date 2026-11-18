import { BookingIdParams, RegenerateOtpBody } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { regenerateOtp } from "@/server/modules/customer/bookings";

/** POST /api/customer/bookings/[id]/otp/regenerate — only after the driver used up the attempts. */
export const POST = handler({ auth: "customer", params: BookingIdParams, body: RegenerateOtpBody }, ({ session, params, body, now }) =>
  regenerateOtp(session, params.bookingId, body.which, now),
);
