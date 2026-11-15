import { z } from "zod";
import { DriverRejectBody } from "@/lib/api/contracts/agency";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { rejectDriver } from "@/server/modules/agency/drivers";

/** POST /api/agency/drivers/[driverId]/reject { reason? } → AgencyDriverDTO · 409 when not pending */
export const POST = handler({ auth: "agency", params: z.object({ driverId: IdSchema("usr") }), body: DriverRejectBody }, ({ session, params, body, now }) =>
  rejectDriver(session, params.driverId, body.reason, now),
);
