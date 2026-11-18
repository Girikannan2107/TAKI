import { OtpVerifyBody } from "@/lib/api/contracts/auth";
import { verifyOtp } from "@/server/auth/otp";
import { handler } from "@/server/http/handler";

/** POST /api/auth/otp/verify — 200 { proofToken, expiresAt, invite? }; 422 otp_invalid (details.attemptsLeft) / too_many_attempts; 410 otp_expired. */
export const POST = handler({ auth: "public", body: OtpVerifyBody }, ({ body, now, ip }) => verifyOtp(body.challengeId, body.code, now, ip));
