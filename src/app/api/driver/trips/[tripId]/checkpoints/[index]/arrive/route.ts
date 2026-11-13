import { z } from "zod";
import { CheckpointActionBody, CheckpointIndexParam, TripIdParam } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { recordCheckpoint } from "@/server/modules/driver/trips";

/** POST /api/driver/trips/[tripId]/checkpoints/[index]/arrive — server-timestamped checkpoint event. */
export const POST = handler(
  { auth: "driver", body: CheckpointActionBody, params: z.object({ tripId: TripIdParam, index: CheckpointIndexParam }) },
  ({ session, params, body, now }) => recordCheckpoint(session, params.tripId, params.index, "arrive", body, now),
);
