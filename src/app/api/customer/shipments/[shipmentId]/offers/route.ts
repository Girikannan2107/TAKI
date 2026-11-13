import { OffersQuery, ShipmentIdParams } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { offersForShipment } from "@/server/modules/customer/search";

/** GET /api/customer/shipments/[id]/offers — matching trips for a saved shipment. */
export const GET = handler({ auth: "customer", params: ShipmentIdParams, query: OffersQuery }, ({ session, params, query, now }) =>
  offersForShipment(session, params.shipmentId, query, now),
);
