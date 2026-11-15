import { OtpResendBody } from "@/lib/api/contracts/auth";
import { resendOtp } from "@/server/auth/otp";
import { handler } from "@/server/http/handler";

/** POST /api/auth/otp/resend — new code for the same challenge (30 s cooldown, max 3). */
export const POST = handler({ auth: "public", body: OtpResendBody }, ({ body, now, ip }) => resendOtp(body.challengeId, now, ip));
