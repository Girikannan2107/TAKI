import { DriverHistoryQuery } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { listHistory } from "@/server/modules/driver/history";

/** GET /api/driver/history?q=&month=YYYY-MM&cursor=&limit= — delivered shipments. */
export const GET = handler({ auth: "driver", query: DriverHistoryQuery }, ({ session, query }) => listHistory(session, query));
