/**
 * Create / reset password step (/auth/create-password).
 * Rules are shared by the schema and the live checklist so they can never drift.
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";

export interface PasswordRule {
  id: "length" | "uppercase" | "number";
  label: string;
  test(password: string): boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", label: `At least ${LIMITS.password.min} characters`, test: (p) => p.length >= LIMITS.password.min },
  { id: "uppercase", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "number", label: "One number", test: (p) => /\d/.test(p) },
];

export const PASSWORD_MESSAGES = {
  required: "Enter a password",
  rules: "Your password doesn't meet all the rules below",
  tooLong: `Use at most ${LIMITS.password.max} characters`,
  confirmRequired: "Confirm your password",
  mismatch: "Passwords don't match",
} as const;

export const NAME_MESSAGES = {
  required: "Enter your full name",
  tooShort: `Name must be at least ${LIMITS.name.min} characters`,
  tooLong: `Name must be at most ${LIMITS.name.max} characters`,
} as const;

export const BUSINESS_NAME_MAX = 80;

/** Full name: trimmed, 2–60 characters. */
export const fullNameField = z.string().superRefine((raw, ctx) => {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") ctx.addIssue({ code: "custom", message: NAME_MESSAGES.required });
  else if (value.length < LIMITS.name.min) ctx.addIssue({ code: "custom", message: NAME_MESSAGES.tooShort });
  else if (value.length > LIMITS.name.max) ctx.addIssue({ code: "custom", message: NAME_MESSAGES.tooLong });
});

export const businessNameField = z
  .string()
  .trim()
  .max(BUSINESS_NAME_MAX, `Business name must be at most ${BUSINESS_NAME_MAX} characters`);

export const passwordField = z.string().superRefine((value, ctx) => {
  if (value === "") ctx.addIssue({ code: "custom", message: PASSWORD_MESSAGES.required });
  else if (value.length > LIMITS.password.max) ctx.addIssue({ code: "custom", message: PASSWORD_MESSAGES.tooLong });
  else if (!PASSWORD_RULES.every((r) => r.test(value))) ctx.addIssue({ code: "custom", message: PASSWORD_MESSAGES.rules });
});

/**
 * @param opts.requireName  sign-up asks for the full name; reset does not.
 */
export function createPasswordSchema(opts: { requireName: boolean }) {
  return z
    .object({
      fullName: z.string(),
      businessName: z.string(),
      password: passwordField,
      confirmPassword: z.string(),
    })
    .superRefine((v, ctx) => {
      if (opts.requireName) {
        const name = fullNameField.safeParse(v.fullName);
        if (!name.success) ctx.addIssue({ code: "custom", path: ["fullName"], message: name.error.issues[0]!.message });
        const business = businessNameField.safeParse(v.businessName);
        if (!business.success)
          ctx.addIssue({ code: "custom", path: ["businessName"], message: business.error.issues[0]!.message });
      }
      if (v.confirmPassword === "") ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: PASSWORD_MESSAGES.confirmRequired });
      else if (v.password !== v.confirmPassword)
        ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: PASSWORD_MESSAGES.mismatch });
    });
}

export interface CreatePasswordFormValues {
  fullName: string;
  businessName: string;
  password: string;
  confirmPassword: string;
}
