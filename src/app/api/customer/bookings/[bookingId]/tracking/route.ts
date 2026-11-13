import { BookingIdParams } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { bookingTracking } from "@/server/modules/customer/bookings";

/** GET /api/customer/bookings/[id]/tracking — TrackingDTO from real events only (liveLocation is always null). */
export const GET = handler({ auth: "customer", params: BookingIdParams }, ({ session, params }) => bookingTracking(session, params.bookingId));
