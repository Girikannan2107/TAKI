/**
 * Browser client for the customer endpoints (P2 §8.4, D3). Every call throws `ApiError`
 * (code, status, message, fields, details) on failure.
 */
import { http, type RequestOptions } from "../http";
import type { Page, ReviewDTO } from "../contracts/common";
import type {
  CreateShipmentInput,
  CustomerBookingDTO,
  CustomerBookingListItem,
  CustomerDashboardDTO,
  OfferSort,
  OffersResponse,
  PaymentHistoryItem,
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
  dashboard: (signal?: AbortSignal) => http.get<CustomerDashboardDTO>("/api/customer/dashboard", { signal }),

  // Shipments
  createShipment: (body: CreateShipmentInput) => http.post<ShipmentDTO>("/api/customer/shipments", body),
  updateShipment: (id: string, body: CreateShipmentInput) => http.patch<ShipmentDTO>(`/api/customer/shipments/${enc(id)}`, body),
  withdrawShipment: (id: string) => http.delete(`/api/customer/shipments/${enc(id)}`),
  shipment: (id: string, signal?: AbortSignal) => http.get<ShipmentWithBookingsDTO>(`/api/customer/shipments/${enc(id)}`, { signal }),
  openShipments: (q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<ShipmentListItem>>("/api/customer/shipments", { query: q as unknown as Q, signal }),

  // Search
  offers: (shipmentId: string, f: OfferFilterParams = {}, signal?: AbortSignal) =>
    http.get<OffersResponse>(`/api/customer/shipments/${enc(shipmentId)}/offers`, { query: f as unknown as Q, signal }),
  guestSearch: (p: GuestSearchParams, signal?: AbortSignal) => http.get<OffersResponse>("/api/customer/search", { query: p as unknown as Q, signal }),
  trip: (tripId: string, p: TripDetailsParams, signal?: AbortSignal) => http.get<TripDetailsDTO>(`/api/customer/trips/${enc(tripId)}`, { query: p as unknown as Q, signal }),

  // Bookings
  requestBooking: (shipmentId: string, tripId: string, idempotencyKey: string) =>
    http.post<CustomerBookingDTO>("/api/customer/bookings", { shipmentId, tripId }, { idempotencyKey }),
  bookings: (q: { tab?: CustomerTab; active?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<CustomerBookingListItem>>("/api/customer/bookings", { query: q as unknown as Q, signal }),
  bookingCounts: (signal?: AbortSignal) => http.get<Record<CustomerTab, number>>("/api/customer/bookings/counts", { signal }),
  booking: (id: string, signal?: AbortSignal) => http.get<CustomerBookingDTO>(`/api/customer/bookings/${enc(id)}`, { signal }),
  cancelBooking: (id: string, reason?: string) => http.post<CustomerBookingDTO>(`/api/customer/bookings/${enc(id)}/cancel`, reason ? { reason } : {}),
  regenerateOtp: (id: string, which: "pickup" | "delivery") =>
    http.post<{ otps: CustomerBookingDTO["otps"] }>(`/api/customer/bookings/${enc(id)}/otp/regenerate`, { which }),
  tracking: (id: string, signal?: AbortSignal) => http.get<TrackingDTO>(`/api/customer/bookings/${enc(id)}/tracking`, { signal }),
  review: (id: string, body: { rating: number; comment?: string }) => http.post<ReviewDTO>(`/api/customer/bookings/${enc(id)}/review`, body),

  // Payments (history; creating/confirming payments is /api/payments/**)
  payments: (q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<PaymentHistoryItem>>("/api/customer/payments", { query: q as unknown as Q, signal }),
};
