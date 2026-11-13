import { ChangePasswordBody } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { changePassword } from "@/server/modules/profile/service";

/** POST /api/me/password — 204; other sessions are signed out. 401 invalid_credentials for a wrong current password. */
export const POST = handler({ auth: "any", body: ChangePasswordBody }, async ({ body, session, now }) => {
  await changePassword(session, body, now);
});
