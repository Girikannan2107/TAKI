import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { publishTrip } from "@/server/modules/agency/trips";

/** POST /api/agency/trips/[tripId]/publish → AgencyTripDTO · 403 agency_not_verified · 409 schedule conflicts (core.tripsLifecycle.publish) */
export const POST = handler({ auth: "agency", params: z.object({ tripId: IdSchema("trp") }) }, ({ session, params, now }) => publishTrip(session, params.tripId, now));
