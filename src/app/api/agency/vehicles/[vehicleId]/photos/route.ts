import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { addVehiclePhoto } from "@/server/modules/agency/vehicles";

/** POST /api/agency/vehicles/[vehicleId]/photos (multipart `photo`) → VehicleDTO (max 5 photos). */
export const POST = handler({ auth: "agency", form: true, params: z.object({ vehicleId: IdSchema("veh") }) }, ({ session, params, form, now }) =>
  addVehiclePhoto(session, params.vehicleId, form!, now),
);
