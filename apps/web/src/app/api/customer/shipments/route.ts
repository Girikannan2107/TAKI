import { CreateShipmentBody, ShipmentsQuery } from "@/lib/api/contracts/customer";
import { created, handler } from "@/server/http/handler";
import { createShipment, listShipments } from "@/server/modules/customer/shipments";
import { toShipmentDTO } from "@/server/views/customer";

/** GET /api/customer/shipments — no tab: open shipments without a booking; ?tab=: shipments by booking tab. */
export const GET = handler({ auth: "customer", query: ShipmentsQuery }, ({ session, query }) => listShipments(session, query));

/** POST /api/customer/shipments — 201 ShipmentDTO. */
export const POST = handler({ auth: "customer", body: CreateShipmentBody }, async ({ session, body, now }) =>
  created(toShipmentDTO(await createShipment(session, body, now))),
);
