import { TripFormOptionsQuery } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { tripFormOptions } from "@/server/modules/agency/trips";

/** GET /api/agency/trips/form-options?departureAt&arrivalAt&excludeTripId → vehicles + approved drivers (busy flags), verification */
export const GET = handler({ auth: "agency", query: TripFormOptionsQuery }, ({ session, query, now }) => tripFormOptions(session, query, now));
