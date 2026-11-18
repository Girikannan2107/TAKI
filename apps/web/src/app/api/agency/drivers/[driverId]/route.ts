import { z } from "zod";
import { DriverPatchBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler, noContent } from "@/server/http/handler";
import { getDriver, removeDriver, setAvailability } from "@/server/modules/agency/drivers";

const params = z.object({ driverId: IdSchema("usr") });

/** GET /api/agency/drivers/[driverId] → AgencyDriverDetailDTO (trips, reviews, schedule) */
export const GET = handler({ auth: "agency", params }, ({ session, params, now }) => getDriver(session, params.driverId, now));

/** PATCH /api/agency/drivers/[driverId] { availability } → AgencyDriverDTO */
export const PATCH = handler({ auth: "agency", params, body: DriverPatchBody }, ({ session, params, body, now }) =>
  setAvailability(session, params.driverId, body.availability, now),
);

/** DELETE /api/agency/drivers/[driverId] → 204 (link removed) · 409 driver_has_active_trips */
export const DELETE = handler({ auth: "agency", params }, async ({ session, params, now }) => {
  await removeDriver(session, params.driverId, now);
  return noContent();
});
