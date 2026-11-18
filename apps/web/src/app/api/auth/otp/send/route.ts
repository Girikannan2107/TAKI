import { OtpSendBody } from "@/lib/api/contracts/auth";
import { sendOtp } from "@/server/auth/otp";
import { created, handler } from "@/server/http/handler";

/** POST /api/auth/otp/send — signup or password-recovery code. 201 OtpChallengeDTO (devOtp only with SMS_PROVIDER=dev). */
export const POST = handler({ auth: "public", body: OtpSendBody }, async ({ body, now, ip }) =>
  created(await sendOtp({ phone: body.phone, role: body.role, purpose: body.purpose }, now, ip)),
);
