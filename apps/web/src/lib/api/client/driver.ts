/**
 * Browser client for the driver app (P2 §8.6). Owner: D4.
 * Every call throws `ApiError` (code, status, message, fields, details) on failure.
 */
import { http } from "../http";
import type { Page } from "../contracts/common";
import type {
  CheckpointActionInput,
  DriverAppProfileDTO,
  DriverDashboardDTO,
  DriverEventDTO,
  DriverHistoryDTO,
  DriverShipmentDTO,
  DriverShipmentListItem,
  DriverShipmentTab,
  DriverTripDTO,
  DriverTripFilter,
  DriverTripListItem,
  PickupInput,
} from "../contracts/driver";

const enc = encodeURIComponent;
const shipment = (id: string) => `/api/driver/shipments/${enc(id)}`;
const trip = (id: string) => `/api/driver/trips/${enc(id)}`;

/** Device time of the action (audit only; the server timestamp is authoritative). */
const clientAt = () => new Date().toISOString();

export const driverApi = {
  dashboard: (signal?: AbortSignal) => http.get<DriverDashboardDTO>("/api/driver/dashboard", { signal }),

  trips: (status: DriverTripFilter, signal?: AbortSignal) => http.get<{ items: DriverTripListItem[] }>("/api/driver/trips", { query: { status }, signal }),
  trip: (tripId: string, signal?: AbortSignal) => http.get<DriverTripDTO>(trip(tripId), { signal }),
  checkpoint: (tripId: string, index: number, kind: "arrive" | "depart", body: CheckpointActionInput = {}) =>
    http.post<DriverTripDTO>(`${trip(tripId)}/checkpoints/${index}/${kind}`, { ...body, clientAt: clientAt() }),
  completeTrip: (tripId: string) => http.post<DriverTripDTO>(`${trip(tripId)}/complete`),

  shipments: (tab: DriverShipmentTab, cursor?: string | null, signal?: AbortSignal) =>
    http.get<Page<DriverShipmentListItem>>("/api/driver/shipments", { query: { tab, cursor }, signal }),
  shipment: (bookingId: string, signal?: AbortSignal) => http.get<DriverShipmentDTO>(shipment(bookingId), { signal }),
  pickup: (bookingId: string, body: Omit<PickupInput, "clientAt">) => http.post<DriverShipmentDTO>(`${shipment(bookingId)}/pickup`, { ...body, clientAt: clientAt() }),
  refusePickup: (bookingId: string, reason: string) => http.post<DriverShipmentDTO>(`${shipment(bookingId)}/refuse-pickup`, { reason }),
  startTransit: (bookingId: string, remarks?: string) => http.post<DriverShipmentDTO>(`${shipment(bookingId)}/start-transit`, { remarks, clientAt: clientAt() }),
  outForDelivery: (bookingId: string, remarks?: string) =>
    http.post<DriverShipmentDTO>(`${shipment(bookingId)}/out-for-delivery`, { remarks, clientAt: clientAt() }),
  deliver: (bookingId: string, input: { otp: string; proof: readonly File[]; receivedBy?: string; remarks?: string }) => {
    const form = new FormData();
    form.set("otp", input.otp);
    if (input.receivedBy) form.set("receivedBy", input.receivedBy);
    if (input.remarks) form.set("remarks", input.remarks);
    form.set("clientAt", clientAt());
    for (const f of input.proof) form.append("proof", f);
    return http.postForm<DriverShipmentDTO>(`${shipment(bookingId)}/deliver`, form);
  },
  addRemark: (bookingId: string, text: string) => http.post<DriverEventDTO>(`${shipment(bookingId)}/remarks`, { text }),

  history: (q: { q?: string; month?: string; cursor?: string | null }, signal?: AbortSignal) =>
    http.get<DriverHistoryDTO>("/api/driver/history", { query: q, signal }),

  profile: (signal?: AbortSignal) => http.get<DriverAppProfileDTO>("/api/driver/profile", { signal }),
  updateProfile: (fullName: string) => http.patch<DriverAppProfileDTO>("/api/driver/profile", { fullName }),
  requestAgencyLink: (agencyId: string) => http.post<DriverAppProfileDTO>("/api/driver/agency-link", { agencyId }),
};
