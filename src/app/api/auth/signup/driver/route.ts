import { DriverSignupBody } from "@/lib/api/contracts/auth";
import { handler, json } from "@/server/http/handler";
import { signupDriver } from "@/server/modules/auth/service";

/** POST /api/auth/signup/driver — 201 SessionUserDTO + session cookie. Invite → active link; agency pick → pending approval. */
export const POST = handler({ auth: "public", body: DriverSignupBody }, async ({ body, now, ip, req }) => {
  const r = await signupDriver(body, now, { ip, userAgent: req.headers.get("user-agent") });
  return json(r.user, 201, { "set-cookie": r.setCookie });
});
