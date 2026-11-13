import { LoginBody } from "@/lib/api/contracts/auth";
import { handler, json } from "@/server/http/handler";
import { login } from "@/server/modules/auth/service";

/** POST /api/auth/login — 200 SessionUserDTO + cookie; 401 invalid_credentials; 423 account_locked; 403 forbidden (details.reason "wrong_role"). */
export const POST = handler({ auth: "public", body: LoginBody }, async ({ body, now, ip, req }) => {
  const r = await login(body, now, { ip, userAgent: req.headers.get("user-agent") });
  return json(r.user, 200, { "set-cookie": r.setCookie });
});
