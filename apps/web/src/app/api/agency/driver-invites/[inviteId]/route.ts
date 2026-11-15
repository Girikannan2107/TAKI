import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { handler, noContent } from "@/server/http/handler";
import { revokeInvite } from "@/server/modules/agency/invites";

/** DELETE /api/agency/driver-invites/[inviteId] → 204 */
export const DELETE = handler({ auth: "agency", params: z.object({ inviteId: IdSchema("inv") }) }, async ({ session, params, now }) => {
  await revokeInvite(session, params.inviteId, now);
  return noContent();
});
