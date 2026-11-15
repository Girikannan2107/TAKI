import { AgencyLinkBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { requestAgencyLink } from "@/server/modules/driver/profile";

/** POST /api/driver/agency-link { agencyId } — request to join a verified agency (link becomes pending). */
export const POST = handler({ auth: "driver", body: AgencyLinkBody }, ({ session, body, now }) => requestAgencyLink(session, body.agencyId, now));
