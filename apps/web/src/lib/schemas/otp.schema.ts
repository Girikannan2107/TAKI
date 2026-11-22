/** Verify OTP step (/auth/verify-otp). The code itself is checked by authService.verifyOtp. */
import { z } from "zod";
import { OTP } from "@/lib/domain/constants";

export const OTP_MESSAGES = {
  incomplete: `Enter all ${OTP.length} digits`,
} as const;

export const otpSchema = z.object({
  code: z.string().regex(new RegExp(`^\\d{${OTP.length}}$`), OTP_MESSAGES.incomplete),
});

export function isCompleteOtp(code: string): boolean {
  return otpSchema.safeParse({ code }).success;
}
