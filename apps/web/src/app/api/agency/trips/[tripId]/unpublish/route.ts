import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { unpublishTrip } from "@/server/modules/agency/trips";

/** POST /api/agency/trips/[tripId]/unpublish → AgencyTripDTO (back to draft; only without awaiting/held bookings) */
export const POST = handler({ auth: "agency", params: z.object({ tripId: IdSchema("trp") }) }, ({ session, params, now }) => unpublishTrip(session, params.tripId, now));
