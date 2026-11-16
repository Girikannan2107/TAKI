/**
 * Hidden admin console contracts (plan decision 4 + 11). Owner: D1.
 * Admin accounts are created only by seed / ops. Document numbers are always masked; files open through
 * the access-checked /api/files route.
 */
import { z } from "zod";
import type { DocumentDTO } from "./auth";
import type { DriverLinkStatus, IsoDate, IsoDateTime, StateCode, VehicleCountRange, VerificationStatus } from "@/lib/domain/model";

export const AdminReviewStatusSchema = z.enum(["pending", "verified", "rejected"]);
export type AdminReviewStatus = z.infer<typeof AdminReviewStatusSchema>;

export const AdminListQuery = z.object({ status: AdminReviewStatusSchema.default("pending") });

export const RejectBody = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300, "Use at most 300 characters"),
});
export type RejectInput = z.input<typeof RejectBody>;

export const SettleBody = z.object({
  agencyId: z.string().regex(/^agc_[a-z0-9]{20}$/, "Invalid agency"),
  through: z.iso.date("Choose a date"),
  reference: z
    .string()
    .trim()
    .min(4, "Enter the bank reference (UTR)")
    .max(40, "Use at most 40 characters")
    .regex(/^[A-Za-z0-9/_-]+$/, "Use letters, digits, - / _ only"),
});
export type SettleInput = z.input<typeof SettleBody>;

export interface AdminVerificationDTO {
  status: VerificationStatus;
  /** Null until the full document set (plus photo) has been uploaded. */
  submittedAt: IsoDateTime | null;
  reviewedAt: IsoDateTime | null;
  reviewedBy: string | null;
  reason: string | null;
}

export interface AdminAgencyListItemDTO {
  id: string;
  agencyName: string;
  ownerName: string;
  districtName: string;
  state: StateCode;
  createdAt: IsoDateTime;
  verification: AdminVerificationDTO;
  /** Identity document + owner photo uploaded (ready for review). */
  documentsComplete: boolean;
}

export interface AdminAgencyDetailDTO extends AdminAgencyListItemDTO {
  phone: string;
  statesCovered: StateCode[];
  vehicleCountRange: VehicleCountRange;
  photoUrl: string | null;
  documents: DocumentDTO[];
  stats: { vehicles: number; drivers: number; ratingAvg: number; ratingCount: number; delivered: number };
}

export interface AdminDriverListItemDTO {
  id: string;
  fullName: string;
  agencyName: string | null;
  linkStatus: DriverLinkStatus | null;
  createdAt: IsoDateTime;
  verification: AdminVerificationDTO;
  /** Licence + Aadhaar + photo uploaded. */
  documentsComplete: boolean;
}

export interface AdminDriverDetailDTO extends AdminDriverListItemDTO {
  phone: string;
  photoUrl: string | null;
  documents: DocumentDTO[];
  /** Licence validity, if given. */
  licenseValidUntil: IsoDate | null;
  stats: { ratingAvg: number; ratingCount: number; delivered: number };
}

export interface AdminOverviewDTO {
  agencies: { awaitingReview: number; awaitingDocuments: number };
  drivers: { awaitingReview: number; awaitingDocuments: number };
  /** Null when settlements are not available yet. */
  settlements: { agencies: number; pendingAmount: number } | null;
}

export interface AdminSettlementRowDTO {
  agencyId: string;
  agencyName: string;
  /** Rupees. */
  pendingAmount: number;
  pendingCount: number;
  oldestDeliveredAt: IsoDateTime;
}

export interface AdminSettlementResultDTO {
  settlementId: string;
  agencyId: string;
  amount: number;
  count: number;
  reference: string;
  settledAt: IsoDateTime;
}

// ── v3 (FastAPI) additions ────────────────────────────────────────────────────
export type AdminPaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refund_pending" | "refunded" | "refund_failed";

export const ADMIN_PAYMENT_STATUSES: readonly AdminPaymentStatus[] = [
  "refund_failed",
  "refund_pending",
  "pending",
  "created",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
];

/** E127 row (payments & refunds console, M7). */
export interface AdminPaymentRowDTO {
  id: string;
  bookingId: string;
  customerId: string;
  agencyId: string;
  status: AdminPaymentStatus;
  amountRupees: number;
  failureReason: string | null;
  /** Last Cashfree order status seen (webhook or verify). */
  cfOrderStatus: string | null;
  refund: { status?: string; amountRupees?: number; completedAt?: string | null; [k: string]: unknown } | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** E108 overview additions. */
export interface AdminOverviewV3Extras {
  vehicles?: { awaitingRcReview: number };
  payments?: { refundFailed: number; pendingOver1h: number };
}
