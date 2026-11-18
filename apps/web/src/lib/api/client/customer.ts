/**
 * Browser client for the customer endpoints (P2 §8.4, D3). Every call throws `ApiError`
 * (code, status, message, fields, details) on failure.
 */
import { http, type RequestOptions } from "../http";
import { paymentsApi } from "./payments";
import type { Page, ReviewDTO } from "../contracts/common";
import type {
  CreateShipmentRequest,
  CustomerBookingDTO,
  CustomerBookingListItem,
  CustomerDashboardDTO,
  OfferSort,
  OffersResponse,
  ShipmentDTO,
  ShipmentListItem,
  ShipmentWithBookingsDTO,
  TrackingDTO,
  TripDetailsDTO,
} from "../contracts/customer";
import type { CustomerTab, GoodsCategory, SpecialHandling, VehicleClass } from "@/lib/domain/model";

export interface OfferFilterParams {
  sort?: OfferSort;
  vehicleClass?: readonly VehicleClass[];
  minPrice?: number;
  maxPrice?: number;
  minCapacityKg?: number;
  date?: string;
}

export interface GuestSearchParams extends OfferFilterParams {
  from: string;
  to: string;
  weightKg: number;
  goods?: GoodsCategory;
  handling?: readonly SpecialHandling[];
}

export type TripDetailsParams =
  | { shipmentId: string }
  | { from: string; to: string; weightKg: number; goods?: GoodsCategory; handling?: readonly SpecialHandling[] };

type Q = RequestOptions["query"];

const enc = encodeURIComponent;

export const customerApi = {
  dashboard: (signal?: AbortSignal) => http.get<CustomerDashboardDTO>("/api/v1/customer/dashboard", { signal }),

  // Shipments
  createShipment: (body: CreateShipmentRequest) => http.post<ShipmentDTO>("/api/v1/customer/shipments", body),
  updateShipment: (id: string, body: CreateShipmentRequest) => http.patch<ShipmentDTO>(`/api/v1/customer/shipments/${enc(id)}`, body),
  withdrawShipment: (id: string) => http.delete(`/api/v1/customer/shipments/${enc(id)}`),
  shipment: (id: string, signal?: AbortSignal) => http.get<ShipmentWithBookingsDTO>(`/api/v1/customer/shipments/${enc(id)}`, { signal }),
  openShipments: (q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<ShipmentListItem>>("/api/v1/customer/shipments", { query: q as unknown as Q, signal }),

  // Search
  offers: (shipmentId: string, f: OfferFilterParams = {}, signal?: AbortSignal) =>
    http.get<OffersResponse>(`/api/v1/customer/shipments/${enc(shipmentId)}/offers`, { query: f as unknown as Q, signal }),
  /** E32: `from` / `to` are Google place ids (sent as fromPlaceId / toPlaceId). */
  guestSearch: ({ from, to, ...rest }: GuestSearchParams, signal?: AbortSignal) =>
    http.get<OffersResponse>("/api/v1/customer/search", { query: { fromPlaceId: from, toPlaceId: to, ...rest } as unknown as Q, signal }),
  /** E33: signed-in (shipmentId) or guest (place ids) trip details. */
  trip: (tripId: string, p: TripDetailsParams, signal?: AbortSignal) =>
    http.get<TripDetailsDTO>(`/api/v1/customer/trips/${enc(tripId)}`, {
      query: ("shipmentId" in p ? p : (({ from, to, ...rest }) => ({ fromPlaceId: from, toPlaceId: to, ...rest }))(p)) as unknown as Q,
      signal,
    }),

  // Bookings
  requestBooking: (shipmentId: string, tripId: string, idempotencyKey: string) =>
    http.post<CustomerBookingDTO>("/api/v1/customer/bookings", { shipmentId, tripId }, { idempotencyKey }),
  bookings: (q: { tab?: CustomerTab; active?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<CustomerBookingListItem>>("/api/v1/customer/bookings", { query: q as unknown as Q, signal }),
  bookingCounts: (signal?: AbortSignal) => http.get<Record<CustomerTab, number>>("/api/v1/customer/bookings/counts", { signal }),
  booking: (id: string, signal?: AbortSignal) => http.get<CustomerBookingDTO>(`/api/v1/customer/bookings/${enc(id)}`, { signal }),
  cancelBooking: (id: string, reason?: string) => http.post<CustomerBookingDTO>(`/api/v1/customer/bookings/${enc(id)}/cancel`, reason ? { reason } : {}),
  regenerateOtp: (id: string, which: "pickup" | "delivery") =>
    http.post<{ otps: CustomerBookingDTO["otps"] }>(`/api/v1/customer/bookings/${enc(id)}/otp/regenerate`, { which }),
  tracking: (id: string, signal?: AbortSignal) => http.get<TrackingDTO>(`/api/v1/customer/bookings/${enc(id)}/tracking`, { signal }),
  review: (id: string, body: { rating: number; comment?: string }) => http.post<ReviewDTO>(`/api/v1/customer/bookings/${enc(id)}/review`, body),

  /** Payment history (E46 GET /payments/history). */
  payments: (q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => paymentsApi.history(q, signal),
};
