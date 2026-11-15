import { z } from "zod";
import { RejectBody } from "@/lib/api/contracts/admin";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { decideDriver } from "@/server/modules/admin/service";

/** POST /api/admin/drivers/[driverId]/reject { reason } — AdminDriverDetailDTO; the driver is notified with the reason. */
export const POST = handler({ auth: "admin", params: z.object({ driverId: IdSchema("usr") }), body: RejectBody }, ({ session, params, body, now }) =>
  decideDriver(session, params.driverId, { verify: false, reason: body.reason }, now),
);
