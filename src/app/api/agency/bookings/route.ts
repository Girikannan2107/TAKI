import { BookingListQuery } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { listBookings } from "@/server/modules/agency/bookings";

/** GET /api/agency/bookings?tab=pending|accepted|confirmed|rejected|cancelled&tripId&cursor → { items, nextCursor, counts } */
export const GET = handler({ auth: "agency", query: BookingListQuery }, ({ session, query, now }) => listBookings(session, query, now));
