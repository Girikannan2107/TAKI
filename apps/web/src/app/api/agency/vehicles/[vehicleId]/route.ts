import { z } from "zod";
import { VehiclePatchBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler, noContent } from "@/server/http/handler";
import { getVehicle, removeVehicle, updateVehicle } from "@/server/modules/agency/vehicles";

const params = z.object({ vehicleId: IdSchema("veh") });

/** GET /api/agency/vehicles/[vehicleId] → VehicleDTO */
export const GET = handler({ auth: "agency", params }, ({ session, params }) => getVehicle(session, params.vehicleId));

/** PATCH /api/agency/vehicles/[vehicleId] (partial VehicleBody + status active|inactive) → VehicleDTO */
export const PATCH = handler({ auth: "agency", params, body: VehiclePatchBody }, ({ session, params, body, now }) => updateVehicle(session, params.vehicleId, body, now));

/** DELETE /api/agency/vehicles/[vehicleId] → 204 (soft remove) · 409 vehicle_has_active_trips */
export const DELETE = handler({ auth: "agency", params }, async ({ session, params, now }) => {
  await removeVehicle(session, params.vehicleId, now);
  return noContent();
});
