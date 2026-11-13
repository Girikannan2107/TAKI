import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { getAgency } from "@/server/modules/admin/service";

/** GET /api/admin/agencies/[agencyId] — AdminAgencyDetailDTO (masked document numbers, file URLs). */
export const GET = handler({ auth: "admin", params: z.object({ agencyId: IdSchema("agc") }) }, ({ session, params }) => getAgency(session, params.agencyId));
