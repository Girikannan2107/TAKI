import { z } from "zod";
import { TripPatchBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler, noContent } from "@/server/http/handler";
import { deleteDraft, getTrip, updateTrip } from "@/server/modules/agency/trips";

const params = z.object({ tripId: IdSchema("trp") });

/** GET /api/agency/trips/[tripId] → AgencyTripDTO (checkpoints, capacity, bookings, publish blockers) */
export const GET = handler({ auth: "agency", params }, ({ session, params, now }) => getTrip(session, params.tripId, now));

/** PATCH /api/agency/trips/[tripId] (TripPatchBody) → AgencyTripDTO · 409 trip_has_bookings / capacity_below_booked */
export const PATCH = handler({ auth: "agency", params, body: TripPatchBody }, ({ session, params, body, now }) => updateTrip(session, params.tripId, body, now));

/** DELETE /api/agency/trips/[tripId] → 204 (never-published drafts only) */
export const DELETE = handler({ auth: "agency", params }, async ({ session, params }) => {
  await deleteDraft(session, params.tripId);
  return noContent();
});
