import { z } from "zod";
import { TripIdParam } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { completeTrip } from "@/server/modules/driver/trips";

/** POST /api/driver/trips/[tripId]/complete */
export const POST = handler({ auth: "driver", params: z.object({ tripId: TripIdParam }) }, ({ session, params, now }) =>
  completeTrip(session, params.tripId, now),
);
