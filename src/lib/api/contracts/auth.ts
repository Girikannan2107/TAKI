/**
 * Auth & account contracts (P2 §8.3, adjusted by plan decision 3/§4.2: one phone = one account; agency and
 * driver documents are uploaded AFTER the account exists, so every signup body is JSON).
 * Isomorphic: used by route handlers and by react-hook-form resolvers. Owner: D1.
 */
import { z } from "zod";
import {
  DistrictIdSchema,
  IdSchema,
  OtpCodeSchema,
  PasswordSchema,
  PhoneSchema,
  ProofTokenSchema,
  PublicRoleSchema,
  StateCodeSchema,
  VehicleCountRangeSchema,
} from "./common";
import type {
  DriverLinkStatus,
  IdentityDocumentKind,
  IsoDate,
  IsoDateTime,
  PublicRole,
  Role,
  StateCode,
  VehicleCountRange,
  VerificationStatus,
} from "@/lib/domain/model";

// ── Shared field rules ───────────────────────────────────────────────────────
export const MIN_AGE_YEARS = 18;
export const UNDERAGE_MESSAGE = "You must be 18 or older to use TAKI";

/** Latest date of birth (YYYY-MM-DD) for someone who is 18 today (IST calendar). */
export function maxDobFor(today: Date = new Date()): IsoDate {
  const ist = new Date(today.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear() - MIN_AGE_YEARS;
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  // Feb 29 → Feb 28 in non-leap target years
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10) as IsoDate;
}

export function isAdult(dob: string, today: Date = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dob) && dob <= maxDobFor(today);
}

const NameSchema = (label: string, max = 60) =>
  z
    .string()
    .trim()
    .min(2, `Enter ${label}`)
    .max(max, `Use at most ${max} characters`)
    .transform((v) => v.replace(/\s+/g, " "));

export const DobSchema = z.iso
  .date("Enter your date of birth")
  .refine((d) => d >= "1900-01-01", "Enter a valid date of birth")
  .refine((d) => isAdult(d), UNDERAGE_MESSAGE);

const TermsSchema = z.literal(true, { error: "Accept the Terms to continue" });

function passwordsMatch<T extends { password: string; confirmPassword: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords don't match" });
}

// ── OTP ──────────────────────────────────────────────────────────────────────
export const OtpSendBody = z.object({
  phone: PhoneSchema,
  role: PublicRoleSchema,
  purpose: z.enum(["signup", "reset_password"]),
});
export type OtpSendInput = z.input<typeof OtpSendBody>;

export const OtpSendForPhoneChangeBody = z.object({ newPhone: PhoneSchema });
export const OtpResendBody = z.object({ challengeId: IdSchema("otp") });
export const OtpVerifyBody = z.object({ challengeId: IdSchema("otp"), code: OtpCodeSchema });

export interface OtpChallengeDTO {
  challengeId: string;
  /** Masked destination, e.g. "+91 ••••• •3210". */
  phoneMasked: string;
  expiresAt: IsoDateTime;
  resendAvailableAt: IsoDateTime;
  attemptsLeft: number;
  resendsLeft: number;
  /** Development only (SMS_PROVIDER=dev): shown on screen with the label "Dev OTP". */
  devOtp?: { code: string; label: "Dev OTP" };
}

export interface OtpVerifyResultDTO {
  proofToken: string;
  expiresAt: IsoDateTime;
  /** Driver signup: a pending agency invite for this phone. */
  invite?: { inviteId: string; agencyName: string; fullName: string };
}

// ── Signup (JSON; documents are uploaded after the account exists) ─────────────
export const CustomerSignupBody = z
  .object({
    proofToken: ProofTokenSchema,
    fullName: NameSchema("your full name"),
    dob: DobSchema,
    acceptTerms: TermsSchema,
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);
export type CustomerSignupInput = z.input<typeof CustomerSignupBody>;

export const AgencySignupBody = z
  .object({
    proofToken: ProofTokenSchema,
    ownerName: NameSchema("the owner's name"),
    agencyName: NameSchema("the agency name", 80),
    districtId: DistrictIdSchema,
    vehicleCountRange: VehicleCountRangeSchema,
    statesCovered: z.array(StateCodeSchema).min(1, "Choose at least one state").max(5),
    acceptTerms: TermsSchema,
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);
export type AgencySignupInput = z.input<typeof AgencySignupBody>;

export const DriverSignupBody = z
  .object({
    proofToken: ProofTokenSchema,
    fullName: NameSchema("your full name"),
    /** Request path: a verified agency picked from GET /api/public/agencies. */
    agencyId: IdSchema("agc").optional(),
    /** Invite path: from the OTP verify response. */
    inviteId: IdSchema("inv").optional(),
    acceptTerms: TermsSchema,
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    if (!v.agencyId && !v.inviteId) ctx.addIssue({ code: "custom", path: ["agencyId"], message: "Choose your agency" });
  });
export type DriverSignupInput = z.input<typeof DriverSignupBody>;

// ── Login / logout / recovery ────────────────────────────────────────────────
export const LoginBody = z.object({
  role: z.enum(["customer", "agency", "driver", "admin"]),
  phone: PhoneSchema,
  password: z.string().min(1, "Enter your password").max(64),
});
export type LoginInput = z.input<typeof LoginBody>;

export const ResetPasswordBody = z
  .object({ proofToken: ProofTokenSchema, password: PasswordSchema, confirmPassword: z.string() })
  .superRefine(passwordsMatch);

export const ChangePasswordBody = z
  .object({ currentPassword: z.string().min(1, "Enter your current password").max(64), password: PasswordSchema, confirmPassword: z.string() })
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    if (v.password && v.password === v.currentPassword)
      ctx.addIssue({ code: "custom", path: ["password"], message: "Choose a password you haven't used here" });
  });

export const ChangePhoneBody = z.object({ proofToken: ProofTokenSchema, currentPassword: z.string().min(1, "Enter your password").max(64) });

// ── Session ──────────────────────────────────────────────────────────────────
export interface SessionUserDTO {
  id: string;
  role: Role;
  name: string;
  phoneMasked: string;
  photoUrl: string | null;
  agency?: { id: string; name: string; verification: VerificationStatus; reason: string | null };
  driver?: {
    agencyLink: { agencyId: string; agencyName: string; status: DriverLinkStatus } | null;
    verification: VerificationStatus;
  };
}

export interface SessionResponseDTO {
  user: SessionUserDTO | null;
}

// ── Profile (GET/PATCH /api/me/profile) ──────────────────────────────────────
export type DocumentStatus = "missing" | "pending" | "verified" | "rejected";

export interface DocumentDTO {
  kind: IdentityDocumentKind;
  label: string;
  /** Masked number, e.g. "XXXX XXXX 1234". Null when not uploaded. */
  numberMasked: string | null;
  /** Access-checked file URLs. */
  fileUrl: string | null;
  backFileUrl: string | null;
  status: DocumentStatus;
  uploadedAt: IsoDateTime | null;
}

interface ProfileBase {
  id: string;
  phone: string;
  phoneMasked: string;
  photoUrl: string | null;
  createdAt: IsoDateTime;
}

export interface CustomerProfileDTO extends ProfileBase {
  role: "customer";
  fullName: string;
  dob: IsoDate;
}

export interface AgencyProfileDTO extends ProfileBase {
  role: "agency";
  agencyId: string;
  ownerName: string;
  agencyName: string;
  districtId: string;
  districtName: string;
  state: StateCode;
  statesCovered: StateCode[];
  vehicleCountRange: VehicleCountRange;
  verification: { status: VerificationStatus; submittedAt: IsoDateTime | null; reviewedAt: IsoDateTime | null; reason: string | null };
  documents: DocumentDTO[];
  stats: { vehicles: number; drivers: number; ratingAvg: number; ratingCount: number; delivered: number };
}

export interface DriverProfileDTO extends ProfileBase {
  role: "driver";
  fullName: string;
  agencyLink: { agencyId: string; agencyName: string; status: DriverLinkStatus; via: "invite" | "request" } | null;
  verification: { status: VerificationStatus; reviewedAt: IsoDateTime | null; reason: string | null };
  documents: DocumentDTO[];
  stats: { ratingAvg: number; ratingCount: number; delivered: number };
}

export interface AdminProfileDTO extends ProfileBase {
  role: "admin";
  name: string;
}

export type ProfileDTO = CustomerProfileDTO | AgencyProfileDTO | DriverProfileDTO | AdminProfileDTO;

export const CustomerProfilePatch = z.object({ fullName: NameSchema("your full name") });
export const AgencyProfilePatch = z.object({
  ownerName: NameSchema("the owner's name"),
  agencyName: NameSchema("the agency name", 80),
  districtId: DistrictIdSchema,
  statesCovered: z.array(StateCodeSchema).min(1, "Choose at least one state").max(5),
  vehicleCountRange: VehicleCountRangeSchema,
});
export const DriverProfilePatch = z.object({ fullName: NameSchema("your full name") });

// ── Identity documents (PUT /api/me/documents/[kind], multipart) ───────────────
export const DOCUMENT_LABELS: Record<IdentityDocumentKind, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN card",
  driving_license: "Driving licence",
};

/** Which documents each role may upload. Agencies upload ONE identity document; drivers need licence + Aadhaar. */
export const DOCUMENT_KINDS_FOR: Record<"agency" | "driver", readonly IdentityDocumentKind[]> = {
  agency: ["aadhaar", "pan", "driving_license"],
  driver: ["driving_license", "aadhaar"],
};

export const DocumentKindSchema = z.enum(["aadhaar", "pan", "driving_license"]);

/** Multipart text fields; files: `file` (required), `backFile` (optional, Aadhaar / licence back side). */
export const DocumentUploadFields = z.object({
  number: z.string().trim().min(8, "Enter the document number").max(24),
  validUntil: z.iso.date().optional(),
});

export interface DocumentUploadResultDTO {
  document: DocumentDTO;
  verification: VerificationStatus;
}

/** PUT /api/me/photo result. */
export interface PhotoResultDTO {
  photoUrl: string;
}

// ── Public agencies (driver signup picker) ───────────────────────────────────
export interface PublicAgencyDTO {
  id: string;
  agencyName: string;
  districtName: string;
  state: StateCode;
}

// ── Geo ──────────────────────────────────────────────────────────────────────
export interface DistrictDTO {
  id: string;
  name: string;
  state: StateCode;
  stateName: string;
}

export interface NearestDistrictDTO {
  districtId: string;
  districtName: string;
  state: StateCode;
  /** Approximate distance from the point to the district centre, km. */
  distanceKm: number;
}

export const NearestDistrictQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const PUBLIC_ROLE_LABELS: Record<PublicRole, string> = {
  customer: "Customer",
  agency: "Travel agency",
  driver: "Driver",
};
