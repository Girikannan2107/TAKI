import { CustomerSignupBody } from "@/lib/api/contracts/auth";
import { handler, json } from "@/server/http/handler";
import { signupCustomer } from "@/server/modules/auth/service";

/** POST /api/auth/signup/customer — 201 SessionUserDTO + session cookie. */
export const POST = handler({ auth: "public", body: CustomerSignupBody }, async ({ body, now, ip, req }) => {
  const r = await signupCustomer(body, now, { ip, userAgent: req.headers.get("user-agent") });
  return json(r.user, 201, { "set-cookie": r.setCookie });
});
