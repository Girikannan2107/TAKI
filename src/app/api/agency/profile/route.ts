import { AgencyProfilePatch } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { getAgencyProfile, updateAgencyProfile } from "@/server/modules/agency/profile";

/** GET /api/agency/profile → AgencyProfileDTO + live counts */
export const GET = handler({ auth: "agency" }, ({ session }) => getAgencyProfile(session));

/** PATCH /api/agency/profile { ownerName, agencyName, districtId, statesCovered, vehicleCountRange } → profile */
export const PATCH = handler({ auth: "agency", body: AgencyProfilePatch }, ({ session, body, now }) => updateAgencyProfile(session, body, now));
