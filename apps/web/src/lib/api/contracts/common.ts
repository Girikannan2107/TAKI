/**
 * Shared zod schemas (client forms: react-hook-form + zodResolver) and DTO building blocks. The FastAPI
 * backend validates every request again; these only give early, field-level feedback.
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import { BODY_TYPES, GOODS_CATEGORIES, PACKAGE_TYPES, SPECIAL_HANDLING, STATE_CODES, VEHICLE_CLASSES, VEHICLE_COUNT_RANGES, type BodyType, type GoodsCategory, type IsoDateTime, type NotificationKind, type NotificationLink, type PackageType, type SpecialHandling, type StateCode, type VehicleClass } from "@/lib/domain/model";
import { toE164 } from "@/lib/domain/phone";

// ── Primitives ────────────────────────────────────────────────────────────────
/** Accepts "98765 43210", "+91…", "0…"; outputs E.164 "+919876543210". */
export const PhoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = toE164(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return e164;
  });

export const PasswordSchema = z
  .string()
  .min(LIMITS.password.min, `Use at least ${LIMITS.password.min} characters`)
  .max(LIMITS.password.max, `Use at most ${LIMITS.password.max} characters`)
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/\d/, "Include a number");

export const OtpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

/** `IdSchema("trp")` matches "trp_" + 20 lowercase base32/alnum chars. */
export const IdSchema = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{20}$`), "Invalid id");
export const StateCodeSchema = z.enum(STATE_CODES as unknown as [StateCode, ...StateCode[]]);
export const PincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode");
export const GoodsCategorySchema = z.enum(GOODS_CATEGORIES as unknown as [GoodsCategory, ...GoodsCategory[]]);
export const SpecialHandlingSchema = z.enum(SPECIAL_HANDLING as unknown as [SpecialHandling, ...SpecialHandling[]]);
export const PackageTypeSchema = z.enum(PACKAGE_TYPES as unknown as [PackageType, ...PackageType[]]);
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES as unknown as [VehicleClass, ...VehicleClass[]]);
export const BodyTypeSchema = z.enum(BODY_TYPES as unknown as [BodyType, ...BodyType[]]);
export const VehicleCountRangeSchema = z.enum(VEHICLE_COUNT_RANGES as unknown as ["1-5", "6-10", "11-25", "26-50", "50+"]);

export const CursorQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Common response shapes ───────────────────────────────────────────────────
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface NotificationDTO {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: NotificationLink | null;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
}

export interface ReviewDTO {
  id: string;
  bookingId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  /** First name only. */
  customerFirstName: string;
  createdAt: IsoDateTime;
}

export interface PaymentSummaryDTO {
  id: string;
  status: "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refund_pending" | "refunded" | "refund_failed";
  provider: "dev" | "cashfree";
  amountRupees: number;
  methodLabel: string | null;
  paidAt: IsoDateTime | null;
  refund: { status: "pending" | "succeeded" | "failed"; amountRupees: number; completedAt: IsoDateTime | null } | null;
}

export function fileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

// ── Public contact form (POST /api/public/contact, D5; used by D4's landing page) ──
export const ContactBody = z
  .object({
    name: z.string().trim().min(2, "Enter your name").max(80),
    phone: z.union([PhoneSchema, z.literal("")]).optional(),
    email: z.union([z.email("Enter a valid email").max(120), z.literal("")]).optional(),
    role: z.enum(["customer", "agency", "driver", "other"]).default("other"),
    message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(2000),
    /** Honeypot: real users leave it empty. */
    website: z.string().max(200).optional(),
  })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), { message: "Give a phone number or an email", path: ["phone"] });
export type ContactInput = z.input<typeof ContactBody>;

export interface ContactResultDTO {
  id: string;
  receivedAt: IsoDateTime;
}

export interface HealthDTO {
  ok: boolean;
  store: "memory" | "firestore" | "firestore-emulator";
  payments: "dev" | "cashfree";
  sms: "dev" | "msg91";
}
