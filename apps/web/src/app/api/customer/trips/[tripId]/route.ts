import { TripDetailsQuery, TripIdParams } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { tripDetails } from "@/server/modules/customer/search";

/**
 * GET /api/customer/trips/[tripId]?shipmentId= (signed-in customer) or ?from&to&weightKg&goods&handling (guest).
 * Public so guests can compare vehicles; a shipmentId requires the owning customer's session.
 */
export const GET = handler({ auth: "public", params: TripIdParams, query: TripDetailsQuery }, ({ session, params, query, now }) =>
  tripDetails(session, params.tripId, query, now),
);
