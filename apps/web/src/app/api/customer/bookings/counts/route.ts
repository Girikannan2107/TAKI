import { handler } from "@/server/http/handler";
import { tabCounts } from "@/server/modules/customer/bookings";

/** GET /api/customer/bookings/counts — { pending, confirmed, picked_up, in_transit, delivered, rejected, cancelled }. */
export const GET = handler({ auth: "customer" }, ({ session }) => tabCounts(session));
