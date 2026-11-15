import { VehicleBody, VehicleListQuery } from "@/lib/api/contracts/agency";
import { created, handler } from "@/server/http/handler";
import { createVehicle, listVehicles } from "@/server/modules/agency/vehicles";

/** GET /api/agency/vehicles?status=active|inactive|all → { items: VehicleDTO[] } */
export const GET = handler({ auth: "agency", query: VehicleListQuery }, ({ session, query }) => listVehicles(session, query.status));

/** POST /api/agency/vehicles (VehicleBody) → 201 VehicleDTO · 409 registration_taken */
export const POST = handler({ auth: "agency", body: VehicleBody }, async ({ session, body, now }) => created(await createVehicle(session, body, now)));
