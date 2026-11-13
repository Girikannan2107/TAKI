import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { decideDriver } from "@/server/modules/admin/service";

/** POST /api/admin/drivers/[driverId]/verify — AdminDriverDetailDTO. 400 when documents are incomplete. */
export const POST = handler({ auth: "admin", params: z.object({ driverId: IdSchema("usr") }) }, ({ session, params, now }) =>
  decideDriver(session, params.driverId, { verify: true }, now),
);
