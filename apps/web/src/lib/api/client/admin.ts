/**
 * Browser client for the hidden admin console (owner: D1). Every call throws `ApiError` on failure.
 */
import { http } from "../http";
import type {
  AdminAgencyDetailDTO,
  AdminAgencyListItemDTO,
  AdminDriverDetailDTO,
  AdminDriverListItemDTO,
  AdminOverviewDTO,
  AdminReviewStatus,
  AdminSettlementResultDTO,
  AdminSettlementRowDTO,
  SettleInput,
} from "../contracts/admin";

const enc = encodeURIComponent;

export const adminApi = {
  overview: () => http.get<AdminOverviewDTO>("/api/admin/overview"),

  agencies: (status: AdminReviewStatus = "pending") => http.get<{ items: AdminAgencyListItemDTO[] }>("/api/admin/agencies", { query: { status } }),
  agency: (id: string) => http.get<AdminAgencyDetailDTO>(`/api/admin/agencies/${enc(id)}`),
  verifyAgency: (id: string) => http.post<AdminAgencyDetailDTO>(`/api/admin/agencies/${enc(id)}/verify`),
  rejectAgency: (id: string, reason: string) => http.post<AdminAgencyDetailDTO>(`/api/admin/agencies/${enc(id)}/reject`, { reason }),

  drivers: (status: AdminReviewStatus = "pending") => http.get<{ items: AdminDriverListItemDTO[] }>("/api/admin/drivers", { query: { status } }),
  driver: (id: string) => http.get<AdminDriverDetailDTO>(`/api/admin/drivers/${enc(id)}`),
  verifyDriver: (id: string) => http.post<AdminDriverDetailDTO>(`/api/admin/drivers/${enc(id)}/verify`),
  rejectDriver: (id: string, reason: string) => http.post<AdminDriverDetailDTO>(`/api/admin/drivers/${enc(id)}/reject`, { reason }),

  settlements: () => http.get<{ items: AdminSettlementRowDTO[]; available: boolean }>("/api/admin/settlements"),
  settle: (body: SettleInput) => http.post<AdminSettlementResultDTO>("/api/admin/settlements", body),
};
