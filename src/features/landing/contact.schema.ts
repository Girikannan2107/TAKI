import { z } from "zod";
import { normalizeIndianMobile } from "@/lib/domain/phone";

const emailSchema = z.email();

/** Landing contact form. Demo only: nothing is sent anywhere. */
export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .min(2, "Name must be at least 2 characters")
    .max(80, "Keep your name under 80 characters"),
  reach: z
    .string()
    .trim()
    .min(1, "Enter your mobile number or email")
    .refine(
      (v) => v === "" || emailSchema.safeParse(v).success || normalizeIndianMobile(v) !== null,
      "Enter a valid email or 10-digit mobile number",
    ),
  message: z
    .string()
    .trim()
    .min(1, "Enter a message")
    .min(10, "Message must be at least 10 characters")
    .max(1000, "Keep your message under 1,000 characters"),
});

export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;
