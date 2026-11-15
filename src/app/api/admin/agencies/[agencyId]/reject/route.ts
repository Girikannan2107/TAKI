import { z } from "zod";
import { RejectBody } from "@/lib/api/contracts/admin";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { decideAgency } from "@/server/modules/admin/service";

/** POST /api/admin/agencies/[agencyId]/reject { reason } — AdminAgencyDetailDTO; the agency is notified with the reason. */
export const POST = handler({ auth: "admin", params: z.object({ agencyId: IdSchema("agc") }), body: RejectBody }, ({ session, params, body, now }) =>
  decideAgency(session, params.agencyId, { verify: false, reason: body.reason }, now),
);
