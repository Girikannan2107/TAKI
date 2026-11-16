/**
 * Browser client for auth & account endpoints (FastAPI E4–E20, E23–E24). Owner: D1.
 * Every call throws `ApiError` (code, status, message, fields, details) on failure.
 *
 * Phone-proof endpoints (E4–E7, E9) take the phone-proof ID token explicitly (`bearer`); everything else
 * sends the session token automatically (http.ts).
 */
import { http } from "../http";
import type {
  AgencySignupRequest,
  AuthResultDTO,
  CustomerSignupRequest,
  DocumentUploadResultDTO,
  DriverSignupRequest,
  LoginInput,
  PhoneStatusDTO,
  PhotoResultDTO,
  PlaceDTO,
  ProfileDTO,
  PublicAgencyDTO,
  SessionResponseDTO,
  SessionUserDTO,
} from "../contracts/auth";
import type { IdentityDocumentKind } from "@/lib/domain/model";

const V1 = "/api/v1";

export const authApi = {
  /** E11: never 401; `user: null` for a missing / invalid token. */
  session: () => http.get<SessionResponseDTO>(`${V1}/auth/session`),
  /** E12: the signed-in user (401 when signed out). */
  me: () => http.get<SessionUserDTO>(`${V1}/me`),

  /** E4: is this verified phone registered? (+ pending driver invite). */
  phoneStatus: (proofToken: string) => http.post<PhoneStatusDTO>(`${V1}/auth/phone/status`, {}, { bearer: proofToken }),

  signupCustomer: (proofToken: string, body: CustomerSignupRequest) =>
    http.post<AuthResultDTO>(`${V1}/auth/signup/customer`, body, { bearer: proofToken }),
  signupAgency: (proofToken: string, body: AgencySignupRequest) => http.post<AuthResultDTO>(`${V1}/auth/signup/agency`, body, { bearer: proofToken }),
  signupDriver: (proofToken: string, body: DriverSignupRequest) => http.post<AuthResultDTO>(`${V1}/auth/signup/driver`, body, { bearer: proofToken }),

  /** E8: phone + password → custom token. Sent without a session token. */
  login: (body: LoginInput) => http.post<AuthResultDTO>(`${V1}/auth/login`, body, { bearer: null }),
  /** E10: `allDevices` revokes every session; the client always signs out locally as well. */
  logout: (allDevices = false) => http.post<void>(`${V1}/auth/logout`, { allDevices }),
  /** E9: new password after a fresh phone proof; signs this device in. */
  resetPassword: (proofToken: string, body: { password: string; confirmPassword: string }) =>
    http.post<AuthResultDTO>(`${V1}/auth/password/reset`, body, { bearer: proofToken }),

  /** E19: verified agencies for the driver signup picker (public). */
  publicAgencies: (q?: string, near?: { lat: number; lng: number }) =>
    http.get<{ items: PublicAgencyDTO[] }>(`${V1}/public/agencies`, { query: { q, near: near ? `${near.lat},${near.lng}` : undefined }, bearer: null }),
};

export const accountApi = {
  profile: () => http.get<ProfileDTO>(`${V1}/me/profile`),
  updateProfile: (body: Record<string, unknown>) => http.patch<ProfileDTO>(`${V1}/me/profile`, body),
  /** E15: other devices are signed out; this device re-signs in with the returned token. */
  changePassword: (body: { currentPassword: string; password: string; confirmPassword: string }) => http.post<AuthResultDTO>(`${V1}/me/password`, body),
  /** E16: `newPhoneProof` = phone-proof token for the NEW number (X-Phone-Proof header). */
  changePhone: (newPhoneProof: string, currentPassword: string) =>
    http.post<AuthResultDTO>(`${V1}/me/phone`, { currentPassword }, { headers: { "x-phone-proof": newPhoneProof } }),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.set("photo", file);
    return http.putForm<PhotoResultDTO>(`${V1}/me/photo`, form);
  },
  /** Identity document (agency: one of aadhaar/pan/driving_license; driver: driving_license + aadhaar). */
  uploadDocument: (kind: IdentityDocumentKind, input: { number: string; file: File; backFile?: File | null; validUntil?: string }) => {
    const form = new FormData();
    form.set("number", input.number);
    form.set("file", input.file);
    if (input.backFile) form.set("backFile", input.backFile);
    if (input.validUntil) form.set("validUntil", input.validUntil);
    return http.putForm<DocumentUploadResultDTO>(`${V1}/me/documents/${kind}`, form);
  },
};

export interface GeocodeResultDTO {
  place: PlaceDTO;
  inServiceArea: boolean;
}

/** E23 / E24: server-side geocoding (Geocoding API, or the fake gazetteer locally). */
export const mapsApi = {
  /**
   * Free text or a place id → place. Signed-in users send their session token; agency signup passes the
   * phone-proof token (`bearer`), which E23 (only) also accepts.
   */
  geocode: (input: { placeId: string } | { address: string }, bearer?: string) =>
    http.post<GeocodeResultDTO>(`${V1}/maps/geocode`, input, bearer ? { bearer } : undefined),
  reverseGeocode: (lat: number, lng: number) => http.post<GeocodeResultDTO>(`${V1}/maps/reverse-geocode`, { lat, lng }),
};
