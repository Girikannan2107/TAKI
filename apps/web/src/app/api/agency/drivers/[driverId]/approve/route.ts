import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { approveDriver } from "@/server/modules/agency/drivers";

/** POST /api/agency/drivers/[driverId]/approve → AgencyDriverDTO · 409 when not pending */
export const POST = handler({ auth: "agency", params: z.object({ driverId: IdSchema("usr") }) }, ({ session, params, now }) => approveDriver(session, params.driverId, now));
