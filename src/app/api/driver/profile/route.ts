import { DriverProfilePatchBody } from "@/lib/api/contracts/driver";
import { handler } from "@/server/http/handler";
import { getDriverProfile, updateDriverProfile } from "@/server/modules/driver/profile";

/** GET /api/driver/profile — account profile (agency link, documents, stats) + reviews. */
export const GET = handler({ auth: "driver" }, ({ session }) => getDriverProfile(session));

/** PATCH /api/driver/profile { fullName } */
export const PATCH = handler({ auth: "driver", body: DriverProfilePatchBody }, ({ session, body, now }) => updateDriverProfile(session, body, now));
