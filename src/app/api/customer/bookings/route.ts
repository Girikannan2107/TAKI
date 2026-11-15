import { BookingsQuery, RequestBookingBody } from "@/lib/api/contracts/customer";
import { created, handler, json } from "@/server/http/handler";
import { requireIdempotencyKey } from "@/server/http/idempotency";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { listBookings, requestBooking } from "@/server/modules/customer/bookings";

/** GET /api/customer/bookings?tab=&active= — CustomerBookingListItem page. */
export const GET = handler({ auth: "customer", query: BookingsQuery }, ({ session, query }) => listBookings(session, query));

/** POST /api/customer/bookings + Idempotency-Key — 201 CustomerBookingDTO (200 on replay). */
export const POST = handler(
  {
    auth: "customer",
    body: RequestBookingBody,
    rateLimit: { rule: RATE_LIMITS.bookingCreate, bucket: ({ session }) => `booking:create:user:${session?.userId ?? "anon"}` },
  },
  async ({ req, session, body, now }) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const { booking, replayed } = await requestBooking(session, { ...body, idempotencyKey }, now);
    return replayed ? json(booking, 200) : created(booking);
  },
);
