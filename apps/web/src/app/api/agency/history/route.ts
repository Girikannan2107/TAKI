import { HistoryQuery } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { searchHistory } from "@/server/modules/agency/history";

/** GET /api/agency/history?q&type&from&to&cursor&limit → { items: HistoryRow[], nextCursor } */
export const GET = handler({ auth: "agency", query: HistoryQuery }, ({ session, query }) => searchHistory(session, query));
