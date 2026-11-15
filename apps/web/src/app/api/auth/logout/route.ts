import { clearedSessionCookie } from "@/server/auth/session-cookie";
import { handler, noContent } from "@/server/http/handler";
import { logout } from "@/server/modules/auth/service";

/** POST /api/auth/logout — revokes the current session (if any) and clears the cookie. Always 204. */
export const POST = handler({ auth: "public" }, async ({ session, now }) => {
  if (session) await logout(session, now);
  return noContent({ "set-cookie": clearedSessionCookie() });
});
