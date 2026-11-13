import { BookingIdParams } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { loadBookingView } from "@/server/modules/customer/bookings";

/** GET /api/customer/bookings/[id] — CustomerBookingDTO (404 unless owned). */
export const GET = handler({ auth: "customer", params: BookingIdParams }, ({ session, params, now }) => loadBookingView(session, params.bookingId, now));
