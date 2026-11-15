import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { removeVehiclePhoto } from "@/server/modules/agency/vehicles";

/** DELETE /api/agency/vehicles/[vehicleId]/photos/[fileId] → VehicleDTO */
export const DELETE = handler({ auth: "agency", params: z.object({ vehicleId: IdSchema("veh"), fileId: IdSchema("fil") }) }, ({ session, params, now }) =>
  removeVehiclePhoto(session, params.vehicleId, params.fileId, now),
);
