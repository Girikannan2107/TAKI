import { AdminListQuery } from "@/lib/api/contracts/admin";
import { handler } from "@/server/http/handler";
import { listAgencies } from "@/server/modules/admin/service";

/** GET /api/admin/agencies?status=pending|verified|rejected — { items: AdminAgencyListItemDTO[] }. */
export const GET = handler({ auth: "admin", query: AdminListQuery }, ({ session, query }) => listAgencies(session, query.status));
