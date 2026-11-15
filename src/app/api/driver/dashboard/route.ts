import { handler } from "@/server/http/handler";
import { getDashboard } from "@/server/modules/driver/dashboard";

/** GET /api/driver/dashboard — counts, next trip, pickups due (or the pending-approval state). */
export const GET = handler({ auth: "driver" }, ({ session }) => getDashboard(session));
