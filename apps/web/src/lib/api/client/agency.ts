/**
 * Browser client for /api/v1/agency/** (FastAPI E47–E85).
 * Every call throws `ApiError` (code, status, message, fields, details) on failure.
 */
import { http } from "../http";
import { reviewsApi } from "./notifications";
import type {
  AgencyBookingDTO,
  AgencyBookingTab,
  AgencyDashboardDTO,
  AgencyDriverDetailDTO,
  AgencyDriverDTO,
  AgencyEarningsDTO,
  AgencyProfileSummaryDTO,
  AgencyTripDTO,
  AgencyTripsTabValue,
  BookingListResponse,
  DriverInviteInput,
  HistoryQueryInput,
  HistoryRow,
  InviteDTO,
  TripFormOptionsDTO,
  TripInput,
  TripListResponse,
  TripPatchInput,
  TripPreviewDTO,
  TripPreviewInput,
  VehicleDTO,
  VehicleInput,
  VehiclePatchInput,
} from "../contracts/agency";
import type { AgencyProfileDTO, AgencyProfilePatchRequest } from "../contracts/auth";
import type { VerificationStatus } from "@/lib/domain/model";

/** E50 */
export interface AgencyVerificationStatusDTO {
  status: VerificationStatus;
  reason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  requirements: { key: "photo" | "identity_document"; done: boolean }[];
}
import type { Page } from "../contracts/common";

const enc = encodeURIComponent;

export type AgencyProfileResponse = AgencyProfileDTO & AgencyProfileSummaryDTO;

export const agencyApi = {
  dashboard: () => http.get<AgencyDashboardDTO>("/api/v1/agency/dashboard"),

  // Vehicles
  vehicles: (status: "active" | "inactive" | "all" = "all") => http.get<{ items: VehicleDTO[] }>("/api/v1/agency/vehicles", { query: { status } }),
  vehicle: (id: string) => http.get<VehicleDTO>(`/api/v1/agency/vehicles/${enc(id)}`),
  createVehicle: (body: VehicleInput) => http.post<VehicleDTO>("/api/v1/agency/vehicles", body),
  updateVehicle: (id: string, body: VehiclePatchInput) => http.patch<VehicleDTO>(`/api/v1/agency/vehicles/${enc(id)}`, body),
  removeVehicle: (id: string) => http.delete(`/api/v1/agency/vehicles/${enc(id)}`),
  addVehiclePhoto: (id: string, file: File) => {
    const form = new FormData();
    form.set("photo", file);
    return http.postForm<VehicleDTO>(`/api/v1/agency/vehicles/${enc(id)}/photos`, form);
  },
  removeVehiclePhoto: (id: string, fileId: string) => http.delete<VehicleDTO>(`/api/v1/agency/vehicles/${enc(id)}/photos/${enc(fileId)}`),

  // Drivers & invites
  drivers: (status: "active" | "pending" | "removed" = "active") => http.get<{ items: AgencyDriverDTO[] }>("/api/v1/agency/drivers", { query: { status } }),
  driver: (id: string) => http.get<AgencyDriverDetailDTO>(`/api/v1/agency/drivers/${enc(id)}`),
  setDriverAvailability: (id: string, availability: "available" | "unavailable") => http.patch<AgencyDriverDTO>(`/api/v1/agency/drivers/${enc(id)}`, { availability }),
  approveDriver: (id: string) => http.post<AgencyDriverDTO>(`/api/v1/agency/drivers/${enc(id)}/approve`),
  rejectDriver: (id: string, reason?: string) => http.post<AgencyDriverDTO>(`/api/v1/agency/drivers/${enc(id)}/reject`, reason ? { reason } : {}),
  removeDriver: (id: string) => http.delete(`/api/v1/agency/drivers/${enc(id)}`),
  invites: () => http.get<{ items: InviteDTO[] }>("/api/v1/agency/driver-invites"),
  invite: (body: DriverInviteInput) => http.post<InviteDTO>("/api/v1/agency/driver-invites", body),
  revokeInvite: (id: string) => http.delete(`/api/v1/agency/driver-invites/${enc(id)}`),

  // Trips
  trips: (q: { tab: AgencyTripsTabValue; cursor?: string | null; limit?: number }) =>
    http.get<TripListResponse>("/api/v1/agency/trips", { query: { tab: q.tab, cursor: q.cursor ?? undefined, limit: q.limit } }),
  trip: (id: string) => http.get<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}`),
  createTrip: (body: TripInput) => http.post<AgencyTripDTO>("/api/v1/agency/trips", body),
  updateTrip: (id: string, body: TripPatchInput) => http.patch<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}`, body),
  deleteDraft: (id: string) => http.delete(`/api/v1/agency/trips/${enc(id)}`),
  previewTrip: (body: TripPreviewInput) => http.post<TripPreviewDTO>("/api/v1/agency/trips/preview", body),
  tripFormOptions: (q: { departureAt?: string | null; arrivalAt?: string | null; excludeTripId?: string | null } = {}) =>
    http.get<TripFormOptionsDTO>("/api/v1/agency/trips/form-options", {
      query: { departureAt: q.departureAt ?? undefined, arrivalAt: q.arrivalAt ?? undefined, excludeTripId: q.excludeTripId ?? undefined },
    }),
  publishTrip: (id: string) => http.post<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}/publish`),
  unpublishTrip: (id: string) => http.post<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}/unpublish`),
  cancelTrip: (id: string, reason: string) => http.post<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}/cancel`, { reason }),
  reassignDriver: (id: string, driverId: string) => http.post<AgencyTripDTO>(`/api/v1/agency/trips/${enc(id)}/reassign`, { driverId }),
  /** E107 reviews for this agency (profile Reviews card, M6). */
  reviews: (agencyId: string, cursor?: string | null) => reviewsApi.forAgency(agencyId, cursor, 10),

  // Bookings
  bookings: (q: { tab: AgencyBookingTab; tripId?: string; cursor?: string | null; limit?: number }) =>
    http.get<BookingListResponse>("/api/v1/agency/bookings", { query: { tab: q.tab, tripId: q.tripId, cursor: q.cursor ?? undefined, limit: q.limit } }),
  booking: (id: string) => http.get<AgencyBookingDTO>(`/api/v1/agency/bookings/${enc(id)}`),
  acceptBooking: (id: string) => http.post<AgencyBookingDTO>(`/api/v1/agency/bookings/${enc(id)}/accept`),
  rejectBooking: (id: string, reason: string) => http.post<AgencyBookingDTO>(`/api/v1/agency/bookings/${enc(id)}/reject`, { reason }),

  // History, earnings
  history: (q: HistoryQueryInput) =>
    http.get<Page<HistoryRow>>("/api/v1/agency/history", { query: { q: q.q, type: q.type, from: q.from, to: q.to, cursor: q.cursor, limit: typeof q.limit === "number" ? q.limit : undefined } }),
  earnings: (q: { from?: string; to?: string } = {}) => http.get<AgencyEarningsDTO>("/api/v1/agency/earnings", { query: { from: q.from, to: q.to } }),

  // Profile & verification
  profile: () => http.get<AgencyProfileResponse>("/api/v1/agency/profile"),
  /** E49: `base` is a place id (Places Autocomplete or E23). */
  updateProfile: (body: AgencyProfilePatchRequest) => http.patch<AgencyProfileResponse>("/api/v1/agency/profile", body),
  /** E50: verification status + what is still missing. */
  verification: () => http.get<AgencyVerificationStatusDTO>("/api/v1/agency/verification"),
  /** E51: submit / resubmit for review once the photo (E17) and one identity document (E18) are uploaded. */
  submitVerification: () => http.post<AgencyProfileResponse>("/api/v1/agency/verification", {}),
  /** E59: vehicle RC document (the RC number is the registration number). */
  uploadVehicleRc: (id: string, input: { file: File; backFile?: File | null; validUntil?: string }) => {
    const form = new FormData();
    form.set("file", input.file);
    if (input.backFile) form.set("backFile", input.backFile);
    if (input.validUntil) form.set("validUntil", input.validUntil);
    return http.putForm<VehicleDTO>(`/api/v1/agency/vehicles/${enc(id)}/documents/rc`, form);
  },
};
