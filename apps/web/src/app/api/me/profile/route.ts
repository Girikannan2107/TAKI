import { handler } from "@/server/http/handler";
import { getProfile, patchProfile } from "@/server/modules/profile/service";

/** GET /api/me/profile — role-discriminated ProfileDTO. */
export const GET = handler({ auth: "any" }, ({ session }) => getProfile(session));

/** PATCH /api/me/profile — customer/driver { fullName }; agency { ownerName, agencyName, districtId, statesCovered, vehicleCountRange }. */
export const PATCH = handler({ auth: ["customer", "agency", "driver"], body: undefined }, async ({ req, session, now }) => {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    const { DomainError } = await import("@/lib/api/contracts/errors");
    throw new DomainError("unsupported_media_type", "Send this request as application/json.");
  }
  const text = await req.text();
  if (text.length > 64 * 1024) {
    const { DomainError } = await import("@/lib/api/contracts/errors");
    throw new DomainError("invalid_request", "Request body is too large.");
  }
  let raw: unknown = {};
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    const { DomainError } = await import("@/lib/api/contracts/errors");
    throw new DomainError("invalid_request", "Request body is not valid JSON.");
  }
  return patchProfile(session, raw, now);
});
