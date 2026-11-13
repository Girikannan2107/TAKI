import { z } from "zod";
import { CancelTripBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { cancelTrip } from "@/server/modules/agency/trips";

/** POST /api/agency/trips/[tripId]/cancel { reason } → AgencyTripDTO (bookings closed + refunds by core) */
export const POST = handler({ auth: "agency", params: z.object({ tripId: IdSchema("trp") }), body: CancelTripBody }, ({ session, params, body, now }) =>
  cancelTrip(session, params.tripId, body.reason, now),
);
