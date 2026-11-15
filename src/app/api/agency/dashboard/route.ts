import { handler } from "@/server/http/handler";
import { getDashboard } from "@/server/modules/agency/dashboard";

/** GET /api/agency/dashboard: totals, trips, pending bookings, revenue, upcoming trips, recent activity. */
export const GET = handler({ auth: "agency" }, ({ session, now }) => getDashboard(session, now));
