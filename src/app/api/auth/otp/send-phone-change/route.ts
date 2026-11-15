import { OtpSendForPhoneChangeBody } from "@/lib/api/contracts/auth";
import { sendOtp } from "@/server/auth/otp";
import { created, handler } from "@/server/http/handler";

/** POST /api/auth/otp/send-phone-change — code to the NEW number of the signed-in user. */
export const POST = handler({ auth: "any", body: OtpSendForPhoneChangeBody }, async ({ body, session, now, ip }) =>
  created(await sendOtp({ phone: body.newPhone, role: session.role, purpose: "change_phone", userId: session.userId }, now, ip)),
);
