/**
 * Browser client for the hidden admin console (FastAPI E108–E128). Owner: D1.
 * Every call throws `ApiError` on failure.
 */
import { http } from "../http";
import type { Page } from "../contracts/common";
import type {
  AdminAgencyDetailDTO,
  AdminBookingDetailDTO,
  AdminAgencyListItemDTO,
  AdminDriverDetailDTO,
  AdminDriverListItemDTO,
  AdminOverviewDTO,
  AdminOverviewV3Extras,
  AdminPaymentRowDTO,
  AdminPaymentStatus,
  AdminReviewStatus,
  AdminSettlementResultDTO,
  AdminSettlementRowDTO,
  SettleInput,
} from "../contracts/admin";

const enc = encodeURIComponent;
const A = "/api/v1/admin";

export const adminApi = {
  overview: () => http.get<AdminOverviewDTO & AdminOverviewV3Extras>(`${A}/overview`),

  agencies: (status: AdminReviewStatus = "pending", cursor?: string | null) =>
    http.get<Page<AdminAgencyListItemDTO>>(`${A}/agencies`, { query: { status, cursor, limit: 50 } }),
  agency: (id: string) => http.get<AdminAgencyDetailDTO>(`${A}/agencies/${enc(id)}`),
  verifyAgency: (id: string) => http.post<AdminAgencyDetailDTO>(`${A}/agencies/${enc(id)}/verify`),
  rejectAgency: (id: string, reason: string) => http.post<AdminAgencyDetailDTO>(`${A}/agencies/${enc(id)}/reject`, { reason }),

  drivers: (status: AdminReviewStatus = "pending", cursor?: string | null) =>
    http.get<Page<AdminDriverListItemDTO>>(`${A}/drivers`, { query: { status, cursor, limit: 50 } }),
  driver: (id: string) => http.get<AdminDriverDetailDTO>(`${A}/drivers/${enc(id)}`),
  verifyDriver: (id: string) => http.post<AdminDriverDetailDTO>(`${A}/drivers/${enc(id)}/verify`),
  rejectDriver: (id: string, reason: string) => http.post<AdminDriverDetailDTO>(`${A}/drivers/${enc(id)}/reject`, { reason }),

  settlements: () => http.get<{ items: AdminSettlementRowDTO[]; available: boolean }>(`${A}/settlements`),
  settle: (body: SettleInput) => http.post<AdminSettlementResultDTO>(`${A}/settlements`, body),

  /** E127: payments by status (default: failed refunds, the ones that need a human). */
  payments: (q: { status?: AdminPaymentStatus; cursor?: string | null; limit?: number } = {}, signal?: AbortSignal) =>
    http.get<Page<AdminPaymentRowDTO>>(`${A}/payments`, { query: { status: q.status, cursor: q.cursor, limit: q.limit }, signal }),
  /** Support lookup (M7). Not in the v3 contract yet: GET /admin/bookings/{id} is requested from D2. */
  booking: (bookingId: string) => http.get<AdminBookingDetailDTO>(`${A}/bookings/${enc(bookingId)}`),
  /** E128: refund_failed → refund_pending (Cashfree dedupes on the same refund id). */
  retryRefund: (paymentId: string) => http.post<AdminPaymentRowDTO>(`${A}/payments/${enc(paymentId)}/retry-refund`),
};
