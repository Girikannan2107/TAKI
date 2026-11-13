import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { getDriver } from "@/server/modules/admin/service";

/** GET /api/admin/drivers/[driverId] — AdminDriverDetailDTO (driver id = user id). */
export const GET = handler({ auth: "admin", params: z.object({ driverId: IdSchema("usr") }) }, ({ session, params }) => getDriver(session, params.driverId));
