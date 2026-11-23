/**
 * Auth & account API types (FastAPI /api/v1/auth/**, /me/**, contract §4): session and profile DTOs and the
 * form schemas (react-hook-form resolvers).
 */
import { z } from "zod";
import { PhoneSchema } from "./common";
import type { DriverLinkStatus, IdentityDocumentKind, IsoDate, IsoDateTime, Role, StateCode, VehicleCountRange, VerificationStatus } from "@/lib/domain/model";

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

// ── Login / logout / recovery ────────────────────────────────────────────────
export const LoginBody = z.object({
  role: z.enum(["customer", "agency", "driver", "admin"]),
  phone: PhoneSchema,
  password: z.string().min(1, "Enter your password").max(64),
});
export type LoginInput = z.input<typeof LoginBody>;

// ── Session ──────────────────────────────────────────────────────────────────
export interface SessionUserDTO {
  id: string;
  role: Role;
  name: string;
  phoneMasked: string;
  photoUrl: string | null;
  agency?: { id: string; name: string; verification: VerificationStatus; reason: string | null } | null;
  driver?: {
    agencyLink: { agencyId: string; agencyName: string; status: DriverLinkStatus } | null;
    verification: VerificationStatus;
  } | null;
  /** v3: when it differs from the ID token's `v` claim, the client force-refreshes the token. */
  claimsVersion?: number;
}

export interface SessionResponseDTO {
  user: SessionUserDTO | null;
}

// ── v3 (FastAPI, Firebase Auth) ──────────────────────────────────────────────
/** A resolved Google (or, locally, fake-gazetteer) place. */
export interface PlaceDTO {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  locality: string | null;
  district: string | null;
  state: StateCode | string;
  stateName: string;
  pincode: string | null;
}

/** E5–E9, E15, E16: sign the MAIN Firebase app in with `customToken` immediately (it expires in 1 h). */
export interface AuthResultDTO {
  customToken: string;
  user: SessionUserDTO;
}

/** E4 POST /auth/phone/status (Bearer = phone-proof token). */
export interface PhoneStatusDTO {
  phone: string;
  phoneMasked: string;
  registered: boolean;
  role: Role | null;
  invite: { inviteId: string; agencyName: string; fullName: string } | null;
}

interface PasswordPair {
  password: string;
  confirmPassword: string;
}

/** E5 body (Bearer = phone proof). */
export interface CustomerSignupRequest extends PasswordPair {
  fullName: string;
  dob: IsoDate;
  acceptTerms: true;
}

/** E6 body. `base.placeId` comes from Places Autocomplete or E23 geocode. */
export interface AgencySignupRequest extends PasswordPair {
  ownerName: string;
  agencyName: string;
  base: { placeId: string };
  vehicleCountRange: VehicleCountRange;
  statesCovered: StateCode[];
  acceptTerms: true;
}

/** E7 body: exactly one of agencyId / inviteId. */
export interface DriverSignupRequest extends PasswordPair {
  fullName: string;
  agencyId?: string;
  inviteId?: string;
  acceptTerms: true;
}

/** E14 agency patch (v3: `base` place instead of districtId). */
export interface AgencyProfilePatchRequest {
  ownerName: string;
  agencyName: string;
  base: { placeId: string };
  statesCovered: StateCode[];
  vehicleCountRange: VehicleCountRange;
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
  /** v3: licence / RC expiry (YYYY-MM-DD). */
  validUntil?: IsoDate | null;
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
  /** v2 only (TS backend); v3 uses `base`. */
  districtId?: string;
  /** v3: the agency's base place. */
  base?: PlaceDTO | null;
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

export interface DocumentUploadResultDTO {
  document: DocumentDTO;
  verification: VerificationStatus;
}

/** PUT /api/me/photo result. */
export interface PhotoResultDTO {
  photoUrl: string;
  file?: { fileId: string; url: string };
}

// ── Public agencies (driver signup picker) ───────────────────────────────────
export interface PublicAgencyDTO {
  id: string;
  agencyName: string;
  districtName: string;
  state: StateCode;
}
