import { ResetPasswordBody } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { resetPassword } from "@/server/modules/auth/service";

/** POST /api/auth/password/reset — new password from a reset proof; revokes every session. 200 { role }. */
export const POST = handler({ auth: "public", body: ResetPasswordBody }, ({ body, now }) => resetPassword(body, now));
