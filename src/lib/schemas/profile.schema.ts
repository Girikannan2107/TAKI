/** Profile pages (/customer/profile, /driver/profile). */
import { z } from "zod";
import { businessNameField, fullNameField } from "./password.schema";

export const customerProfileSchema = z.object({ fullName: fullNameField });
export type CustomerProfileValues = z.infer<typeof customerProfileSchema>;

export const driverProfileSchema = z.object({
  fullName: fullNameField,
  businessName: businessNameField.min(1, "Enter your business name"),
});
export type DriverProfileValues = z.infer<typeof driverProfileSchema>;

/** One form shape for both roles; the business name is only validated for drivers. */
export function profileFormSchema(role: "customer" | "driver") {
  return z.object({
    fullName: fullNameField,
    businessName: role === "driver" ? driverProfileSchema.shape.businessName : z.string(),
  });
}
export interface ProfileFormValues {
  fullName: string;
  businessName: string;
}

/** Stored format, e.g. "TN 37 XX 4587". */
export const REGISTRATION_PATTERN = /^[A-Z]{2} \d{1,2} [A-Z]{1,3} \d{4}$/;

export const REGISTRATION_MESSAGES = {
  required: "Enter the registration number",
  invalid: "Use the format TN 37 XX 4587",
} as const;

/**
 * Normalise user input to the stored format: uppercase, separators removed, then re-spaced
 * ("tn37xx4587", "TN-37-XX-4587" → "TN 37 XX 4587"). Unparseable input is returned uppercased/trimmed.
 */
export function normalizeRegistration(input: string): string {
  const compact = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/.exec(compact);
  if (!m) return (input ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

export const registrationField = z.string().superRefine((raw, ctx) => {
  if (raw.trim() === "") ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.required });
  else if (!REGISTRATION_PATTERN.test(normalizeRegistration(raw)))
    ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.invalid });
});

export const vehicleRegistrationSchema = z.object({ registrationNumber: registrationField });
export type VehicleRegistrationValues = z.infer<typeof vehicleRegistrationSchema>;
