import { DriverTripsQuery } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { listTrips } from "@/server/modules/driver/trips";

/** GET /api/driver/trips?status=upcoming|active|completed */
export const GET = handler({ auth: "driver", query: DriverTripsQuery }, ({ session, query }) => listTrips(session, query.status));
