/**
 * Browser client for /api/agency/** (P2 §8.5). Owner: D2.
 * Every call throws `ApiError` (code, status, message, fields, details) on failure.
 */
import { http } from "../http";
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
import type { AgencyProfileDTO } from "../contracts/auth";
import type { Page } from "../contracts/common";

const enc = encodeURIComponent;

export type AgencyProfileResponse = AgencyProfileDTO & AgencyProfileSummaryDTO;

export const agencyApi = {
  dashboard: () => http.get<AgencyDashboardDTO>("/api/agency/dashboard"),

  // Vehicles
  vehicles: (status: "active" | "inactive" | "all" = "all") => http.get<{ items: VehicleDTO[] }>("/api/agency/vehicles", { query: { status } }),
  vehicle: (id: string) => http.get<VehicleDTO>(`/api/agency/vehicles/${enc(id)}`),
  createVehicle: (body: VehicleInput) => http.post<VehicleDTO>("/api/agency/vehicles", body),
  updateVehicle: (id: string, body: VehiclePatchInput) => http.patch<VehicleDTO>(`/api/agency/vehicles/${enc(id)}`, body),
  removeVehicle: (id: string) => http.delete(`/api/agency/vehicles/${enc(id)}`),
  addVehiclePhoto: (id: string, file: File) => {
    const form = new FormData();
    form.set("photo", file);
    return http.postForm<VehicleDTO>(`/api/agency/vehicles/${enc(id)}/photos`, form);
  },
  removeVehiclePhoto: (id: string, fileId: string) => http.delete<VehicleDTO>(`/api/agency/vehicles/${enc(id)}/photos/${enc(fileId)}`),

  // Drivers & invites
  drivers: (status: "active" | "pending" | "removed" = "active") => http.get<{ items: AgencyDriverDTO[] }>("/api/agency/drivers", { query: { status } }),
  driver: (id: string) => http.get<AgencyDriverDetailDTO>(`/api/agency/drivers/${enc(id)}`),
  setDriverAvailability: (id: string, availability: "available" | "unavailable") => http.patch<AgencyDriverDTO>(`/api/agency/drivers/${enc(id)}`, { availability }),
  approveDriver: (id: string) => http.post<AgencyDriverDTO>(`/api/agency/drivers/${enc(id)}/approve`),
  rejectDriver: (id: string, reason?: string) => http.post<AgencyDriverDTO>(`/api/agency/drivers/${enc(id)}/reject`, reason ? { reason } : {}),
  removeDriver: (id: string) => http.delete(`/api/agency/drivers/${enc(id)}`),
  invites: () => http.get<{ items: InviteDTO[] }>("/api/agency/driver-invites"),
  invite: (body: DriverInviteInput) => http.post<InviteDTO>("/api/agency/driver-invites", body),
  revokeInvite: (id: string) => http.delete(`/api/agency/driver-invites/${enc(id)}`),

  // Trips
  trips: (q: { tab: AgencyTripsTabValue; cursor?: string | null; limit?: number }) =>
    http.get<TripListResponse>("/api/agency/trips", { query: { tab: q.tab, cursor: q.cursor ?? undefined, limit: q.limit } }),
  trip: (id: string) => http.get<AgencyTripDTO>(`/api/agency/trips/${enc(id)}`),
  createTrip: (body: TripInput) => http.post<AgencyTripDTO>("/api/agency/trips", body),
  updateTrip: (id: string, body: TripPatchInput) => http.patch<AgencyTripDTO>(`/api/agency/trips/${enc(id)}`, body),
  deleteDraft: (id: string) => http.delete(`/api/agency/trips/${enc(id)}`),
  previewTrip: (body: TripPreviewInput) => http.post<TripPreviewDTO>("/api/agency/trips/preview", body),
  tripFormOptions: (q: { departureAt?: string | null; arrivalAt?: string | null; excludeTripId?: string | null } = {}) =>
    http.get<TripFormOptionsDTO>("/api/agency/trips/form-options", {
      query: { departureAt: q.departureAt ?? undefined, arrivalAt: q.arrivalAt ?? undefined, excludeTripId: q.excludeTripId ?? undefined },
    }),
  publishTrip: (id: string) => http.post<AgencyTripDTO>(`/api/agency/trips/${enc(id)}/publish`),
  unpublishTrip: (id: string) => http.post<AgencyTripDTO>(`/api/agency/trips/${enc(id)}/unpublish`),
  cancelTrip: (id: string, reason: string) => http.post<AgencyTripDTO>(`/api/agency/trips/${enc(id)}/cancel`, { reason }),
  reassignDriver: (id: string, driverId: string) => http.post<AgencyTripDTO>(`/api/agency/trips/${enc(id)}/reassign`, { driverId }),

  // Bookings
  bookings: (q: { tab: AgencyBookingTab; tripId?: string; cursor?: string | null; limit?: number }) =>
    http.get<BookingListResponse>("/api/agency/bookings", { query: { tab: q.tab, tripId: q.tripId, cursor: q.cursor ?? undefined, limit: q.limit } }),
  booking: (id: string) => http.get<AgencyBookingDTO>(`/api/agency/bookings/${enc(id)}`),
  acceptBooking: (id: string) => http.post<AgencyBookingDTO>(`/api/agency/bookings/${enc(id)}/accept`),
  rejectBooking: (id: string, reason: string) => http.post<AgencyBookingDTO>(`/api/agency/bookings/${enc(id)}/reject`, { reason }),

  // History, earnings
  history: (q: HistoryQueryInput) =>
    http.get<Page<HistoryRow>>("/api/agency/history", { query: { q: q.q, type: q.type, from: q.from, to: q.to, cursor: q.cursor, limit: q.limit } }),
  earnings: (q: { from?: string; to?: string } = {}) => http.get<AgencyEarningsDTO>("/api/agency/earnings", { query: q }),

  // Profile & verification
  profile: () => http.get<AgencyProfileResponse>("/api/agency/profile"),
  updateProfile: (body: { ownerName: string; agencyName: string; districtId: string; statesCovered: string[]; vehicleCountRange: string }) =>
    http.patch<AgencyProfileResponse>("/api/agency/profile", body),
  submitVerification: (input: { kind?: "aadhaar" | "pan" | "driving_license"; number?: string; file?: File | null; backFile?: File | null; photo?: File | null }) => {
    const form = new FormData();
    if (input.file) {
      form.set("kind", input.kind ?? "aadhaar");
      form.set("number", input.number ?? "");
      form.set("file", input.file);
      if (input.backFile) form.set("backFile", input.backFile);
    }
    if (input.photo) form.set("photo", input.photo);
    return http.postForm<AgencyProfileResponse>("/api/agency/verification", form);
  },
};
