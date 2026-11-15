import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { decideAgency } from "@/server/modules/admin/service";

/** POST /api/admin/agencies/[agencyId]/verify — AdminAgencyDetailDTO. 400 when documents are incomplete. */
export const POST = handler({ auth: "admin", params: z.object({ agencyId: IdSchema("agc") }) }, ({ session, params, now }) =>
  decideAgency(session, params.agencyId, { verify: true }, now),
);
