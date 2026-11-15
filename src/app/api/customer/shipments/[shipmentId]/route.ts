import { ShipmentIdParams, UpdateShipmentBody } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { getShipmentWithBookings, updateShipment, withdrawShipment } from "@/server/modules/customer/shipments";
import { toShipmentDTO } from "@/server/views/customer";

/** GET /api/customer/shipments/[id] — ShipmentDTO & { bookings }. */
export const GET = handler({ auth: "customer", params: ShipmentIdParams }, ({ session, params }) => getShipmentWithBookings(session, params.shipmentId));

/** PATCH — only while open with no booking (409 shipment_has_open_booking). */
export const PATCH = handler({ auth: "customer", params: ShipmentIdParams, body: UpdateShipmentBody }, async ({ session, params, body, now }) =>
  toShipmentDTO(await updateShipment(session, params.shipmentId, body, now)),
);

/** DELETE — withdraw (204). */
export const DELETE = handler({ auth: "customer", params: ShipmentIdParams }, async ({ session, params, now }) => {
  await withdrawShipment(session, params.shipmentId, now);
});
