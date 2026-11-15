import { TripBody, TripListQuery } from "@/lib/api/contracts/agency";
import { created, handler } from "@/server/http/handler";
import { createTrip, listTrips } from "@/server/modules/agency/trips";

/** GET /api/agency/trips?tab=upcoming|active|completed|cancelled|drafts&cursor&limit → { items, nextCursor, counts } */
export const GET = handler({ auth: "agency", query: TripListQuery }, ({ session, query, now }) => listTrips(session, query, now));

/** POST /api/agency/trips (TripBody; publish:false = draft) → 201 AgencyTripDTO · 403 agency_not_verified · 409 schedule conflicts · 422 */
export const POST = handler({ auth: "agency", body: TripBody }, async ({ session, body, now }) => created(await createTrip(session, body, now)));
