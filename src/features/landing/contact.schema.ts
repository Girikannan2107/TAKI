import { z } from "zod";
import { normalizeIndianMobile } from "@/lib/domain/phone";

const emailSchema = z.email();

export const CONTACT_ROLES = ["customer", "agency", "driver", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * Landing contact form values. One "mobile or email" field (`reach`) that ContactForm maps onto D5's
 * `ContactBody` (`phone` | `email`, contracts/common) for POST /api/public/contact. The server re-validates.
 */
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
  role: z.enum(CONTACT_ROLES),
  message: z
    .string()
    .trim()
    .min(1, "Enter a message")
    .min(10, "Message must be at least 10 characters")
    .max(1000, "Keep your message under 1,000 characters"),
  /** Honeypot: hidden from people; bots that fill it are dropped server-side. */
  website: z.string().max(200).optional(),
});

export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;
