import { TripPreviewBody } from "@/lib/api/contracts/agency";
import { handler } from "@/server/http/handler";
import { previewTrip } from "@/server/modules/agency/trips";

/** POST /api/agency/trips/preview → { checkpoints: [{ km }], distanceKm, durationMins, earningsPreview } */
export const POST = handler({ auth: "agency", body: TripPreviewBody }, ({ body }) => previewTrip(body));
