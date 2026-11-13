import { DriverShipmentsQuery } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { listShipments } from "@/server/modules/driver/shipments";

/** GET /api/driver/shipments?tab=pending_pickup|in_transit|delivered&cursor=&limit= */
export const GET = handler({ auth: "driver", query: DriverShipmentsQuery }, ({ session, query }) => listShipments(session, query));
