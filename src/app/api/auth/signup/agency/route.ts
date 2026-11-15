import { AgencySignupBody } from "@/lib/api/contracts/auth";
import { handler, json } from "@/server/http/handler";
import { signupAgency } from "@/server/modules/auth/service";

/** POST /api/auth/signup/agency — 201 SessionUserDTO + session cookie. Documents follow on /agency/profile/verification. */
export const POST = handler({ auth: "public", body: AgencySignupBody }, async ({ body, now, ip, req }) => {
  const r = await signupAgency(body, now, { ip, userAgent: req.headers.get("user-agent") });
  return json(r.user, 201, { "set-cookie": r.setCookie });
});
