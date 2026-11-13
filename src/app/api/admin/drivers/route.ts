import { AdminListQuery } from "@/lib/api/contracts/admin";
import { handler } from "@/server/http/handler";
import { listDrivers } from "@/server/modules/admin/service";

/** GET /api/admin/drivers?status=pending|verified|rejected — { items: AdminDriverListItemDTO[] }. */
export const GET = handler({ auth: "admin", query: AdminListQuery }, ({ session, query }) => listDrivers(session, query.status));
