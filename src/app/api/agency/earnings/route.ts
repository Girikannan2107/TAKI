import { EarningsQuery } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { getEarnings } from "@/server/modules/agency/earnings";

/** GET /api/agency/earnings?from&to → AgencyEarningsDTO (read-only; D5 earnings read model) */
export const GET = handler({ auth: "agency", query: EarningsQuery }, ({ session, query, now }) => getEarnings(session, query, now));
