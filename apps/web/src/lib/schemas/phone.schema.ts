/**
 * Mobile number step (/auth/phone) and the mobile field shared with login.
 * The field holds the 10-digit national number typed into <PhoneInput> (no +91).
 */
import { z } from "zod";
import { normalizeIndianMobile } from "@/lib/domain/phone";

export const MOBILE_MESSAGES = {
  required: "Enter your mobile number",
  invalid: "Enter a valid 10-digit Indian mobile number",
} as const;

/** One message per state: empty → required; anything else that isn't 10 digits starting 6–9 → invalid. */
export const mobileField = z.string().superRefine((raw, ctx) => {
  const value = raw.trim();
  if (value === "") {
    ctx.addIssue({ code: "custom", message: MOBILE_MESSAGES.required });
    return;
  }
  if (!/^\d{10}$/.test(value) || !normalizeIndianMobile(value)) {
    ctx.addIssue({ code: "custom", message: MOBILE_MESSAGES.invalid });
  }
});

export const phoneSchema = z.object({ mobile: mobileField });

export type PhoneFormValues = z.infer<typeof phoneSchema>;

/** Keep only digits (letters can't be entered into the phone field). */
export function digitsOnly(value: string, max = 10): string {
  return value.replace(/\D/g, "").slice(0, max);
}
