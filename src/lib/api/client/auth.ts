/**
 * Browser client for auth & account endpoints (P2 §8.3). Owner: D1.
 * Every call throws `ApiError` (code, status, message, fields, details) on failure.
 */
import { http } from "../http";
import type {
  AgencySignupInput,
  CustomerSignupInput,
  DistrictDTO,
  DocumentUploadResultDTO,
  DriverSignupInput,
  LoginInput,
  NearestDistrictDTO,
  OtpChallengeDTO,
  OtpSendInput,
  OtpVerifyResultDTO,
  PhotoResultDTO,
  ProfileDTO,
  PublicAgencyDTO,
  SessionResponseDTO,
  SessionUserDTO,
} from "../contracts/auth";
import type { IdentityDocumentKind } from "@/lib/domain/model";

export const authApi = {
  session: () => http.get<SessionResponseDTO>("/api/auth/session"),

  sendOtp: (body: OtpSendInput) => http.post<OtpChallengeDTO>("/api/auth/otp/send", body),
  resendOtp: (challengeId: string) => http.post<OtpChallengeDTO>("/api/auth/otp/resend", { challengeId }),
  verifyOtp: (challengeId: string, code: string) => http.post<OtpVerifyResultDTO>("/api/auth/otp/verify", { challengeId, code }),

  signupCustomer: (body: CustomerSignupInput) => http.post<SessionUserDTO>("/api/auth/signup/customer", body),
  signupAgency: (body: AgencySignupInput) => http.post<SessionUserDTO>("/api/auth/signup/agency", body),
  signupDriver: (body: DriverSignupInput) => http.post<SessionUserDTO>("/api/auth/signup/driver", body),

  login: (body: LoginInput) => http.post<SessionUserDTO>("/api/auth/login", body),
  logout: () => http.post<void>("/api/auth/logout"),
  resetPassword: (body: { proofToken: string; password: string; confirmPassword: string }) =>
    http.post<{ role: SessionUserDTO["role"] }>("/api/auth/password/reset", body),

  /** Verified agencies for the driver signup picker. */
  publicAgencies: (q?: string, districtId?: string) =>
    http.get<{ items: PublicAgencyDTO[] }>("/api/public/agencies", { query: { q, districtId } }),
};

export const accountApi = {
  profile: () => http.get<ProfileDTO>("/api/me/profile"),
  updateProfile: (body: Record<string, unknown>) => http.patch<ProfileDTO>("/api/me/profile", body),
  changePassword: (body: { currentPassword: string; password: string; confirmPassword: string }) => http.post<void>("/api/me/password", body),
  sendPhoneChangeOtp: (newPhone: string) => http.post<OtpChallengeDTO>("/api/auth/otp/send-phone-change", { newPhone }),
  changePhone: (body: { proofToken: string; currentPassword: string }) => http.post<SessionUserDTO>("/api/me/phone", body),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.set("photo", file);
    return http.putForm<PhotoResultDTO>("/api/me/photo", form);
  },
  /** Identity document (agency: one of aadhaar/pan/driving_license; driver: driving_license + aadhaar). */
  uploadDocument: (kind: IdentityDocumentKind, input: { number: string; file: File; backFile?: File | null; validUntil?: string }) => {
    const form = new FormData();
    form.set("number", input.number);
    form.set("file", input.file);
    if (input.backFile) form.set("backFile", input.backFile);
    if (input.validUntil) form.set("validUntil", input.validUntil);
    return http.putForm<DocumentUploadResultDTO>(`/api/me/documents/${kind}`, form);
  },
};

export const geoApi = {
  districts: () => http.get<{ items: DistrictDTO[] }>("/api/geo/districts"),
  nearestDistrict: (lat: number, lng: number) => http.get<NearestDistrictDTO>("/api/geo/nearest-district", { query: { lat, lng } }),
};
