import { z } from "zod";
import { TripIdParam } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { getTrip } from "@/server/modules/driver/trips";

/** GET /api/driver/trips/[tripId] — trip run view (checkpoints with actual times, shipments per stop). */
export const GET = handler({ auth: "driver", params: z.object({ tripId: TripIdParam }) }, ({ session, params }) => getTrip(session, params.tripId));
