import { z } from "zod";
import { ReassignDriverBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { reassignDriver } from "@/server/modules/agency/trips";

/** POST /api/agency/trips/[tripId]/reassign { driverId } → AgencyTripDTO · 409 driver_schedule_conflict */
export const POST = handler({ auth: "agency", params: z.object({ tripId: IdSchema("trp") }), body: ReassignDriverBody }, ({ session, params, body, now }) =>
  reassignDriver(session, params.tripId, body.driverId, now),
);
