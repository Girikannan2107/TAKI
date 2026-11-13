import { DriverListQuery } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { listDrivers } from "@/server/modules/agency/drivers";

/** GET /api/agency/drivers?status=active|pending|removed → { items: AgencyDriverDTO[] } */
export const GET = handler({ auth: "agency", query: DriverListQuery }, ({ session, query, now }) => listDrivers(session, query.status, now));
