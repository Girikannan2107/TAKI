/**
 * Shared zod schemas and DTO building blocks (P2 §8.2). Isomorphic: used by route
 * handlers for validation AND by client forms (react-hook-form + zodResolver).
 * D5 owns this file — request additions via SendMessage.
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import {
  BODY_TYPES,
  GOODS_CATEGORIES,
  PACKAGE_TYPES,
  PUBLIC_ROLES,
  ROLES,
  SPECIAL_HANDLING,
  STATE_CODES,
  VEHICLE_CLASSES,
  VEHICLE_COUNT_RANGES,
  type BodyType,
  type BookingStatus,
  type CustomerTab,
  type GoodsCategory,
  type IsoDateTime,
  type NotificationKind,
  type NotificationLink,
  type PackageType,
  type PublicRole,
  type Role,
  type SpecialHandling,
  type StateCode,
  type VehicleClass,
} from "@/lib/domain/model";
import { toE164 } from "@/lib/domain/phone";
import { getDistrict, isDistrictId } from "@/lib/domain/places/districts";
import { isPlaceId } from "@/lib/domain/places/places";
import { pincodeMatchesState } from "@/lib/domain/places/pincode";

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
export const ProofTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid verification token");

/** `IdSchema("trp")` matches "trp_" + 20 lowercase base32/alnum chars. */
export const IdSchema = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{20}$`), "Invalid id");
export const BookingIdSchema = z.string().regex(/^TAKI\d{6}$/, "Invalid booking id");

export const RoleSchema = z.enum(ROLES as unknown as [Role, ...Role[]]);
export const PublicRoleSchema = z.enum(PUBLIC_ROLES as unknown as [PublicRole, ...PublicRole[]]);
export const StateCodeSchema = z.enum(STATE_CODES as unknown as [StateCode, ...StateCode[]]);
export const DistrictIdSchema = z.string().refine(isDistrictId, "Choose a district from the list");
export const PlaceIdSchema = z.string().refine(isPlaceId, "Choose a place from the list");
export const PincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode");
export const GoodsCategorySchema = z.enum(GOODS_CATEGORIES as unknown as [GoodsCategory, ...GoodsCategory[]]);
export const SpecialHandlingSchema = z.enum(SPECIAL_HANDLING as unknown as [SpecialHandling, ...SpecialHandling[]]);
export const PackageTypeSchema = z.enum(PACKAGE_TYPES as unknown as [PackageType, ...PackageType[]]);
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES as unknown as [VehicleClass, ...VehicleClass[]]);
export const BodyTypeSchema = z.enum(BODY_TYPES as unknown as [BodyType, ...BodyType[]]);
export const VehicleCountRangeSchema = z.enum(VEHICLE_COUNT_RANGES as unknown as ["1-5", "6-10", "11-25", "26-50", "50+"]);
export const IsoDateSchema = z.iso.date();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

// ── Address ───────────────────────────────────────────────────────────────────
const AddressBase = z.object({
  line1: z.string().trim().min(3, "Enter the address").max(120),
  line2: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(80).optional(),
  districtId: DistrictIdSchema,
  state: StateCodeSchema,
  pincode: PincodeSchema,
  location: z.object({ lat: z.number().min(6).max(21), lng: z.number().min(68).max(98) }).optional(),
  source: z.enum(["manual", "current_location"]),
});

/** Address input. Server derives `districtName` from `districtId`. */
export const AddressSchema = AddressBase.superRefine((a, ctx) => {
  const d = getDistrict(a.districtId);
  if (d && d.state !== a.state) ctx.addIssue({ code: "custom", path: ["districtId"], message: "This district is not in the selected state" });
  if (/^[1-9]\d{5}$/.test(a.pincode) && !pincodeMatchesState(a.pincode, a.state))
    ctx.addIssue({ code: "custom", path: ["pincode"], message: "This pincode doesn't belong to the selected state" });
});
export type AddressInput = z.infer<typeof AddressSchema>;

// ── Headers / paging ─────────────────────────────────────────────────────────
/** Value of the "Idempotency-Key" request header. */
export const IdempotencyKeyHeader = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, "Invalid Idempotency-Key");
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export const CursorQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorQueryInput = z.infer<typeof CursorQuery>;

/** Query-string boolean: "true"/"1" → true. */
export const QueryBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "true" || v === "1");

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

export interface BookingStatusInfo {
  status: BookingStatus;
  tab: CustomerTab;
}

/** Result of uploading a file. `url` is always the access-checked `/api/files/{id}`. */
export interface FileDTO {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export function fileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}
