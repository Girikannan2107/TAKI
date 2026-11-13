import "server-only";
/**
 * Earnings & settlements (owner decision: read-only settlements, no payouts).
 * Earnings are created on delivery (bookings.deliver); ops/admin record settlements.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { IsoDate } from "@/lib/domain/model";
import type { EarningDoc, PaymentDoc, SettlementDoc } from "../db/schema";

export interface AgencyEarningsReadModel {
  summary: { total: number; pending: number; settled: number; onHold: number; thisMonth: number; lastMonth: number };
  /** Last 6 IST months, oldest first. */
  monthlySeries: Array<{ month: string; amount: number }>;
  byTrip: Array<{ tripId: string; routeLabel: string; deliveredBookings: number; agencyNet: number; lastDeliveredAt: string }>;
  byBooking: EarningDoc[];
  payments: PaymentDoc[];
  settlements: SettlementDoc[];
}

export async function agencyEarnings(_agencyId: string, _range: { from?: IsoDate; to?: IsoDate }, _now: Date): Promise<AgencyEarningsReadModel> {
  throw new DomainError("not_implemented");
}

export interface SettleInput {
  agencyId: string;
  /** Settle pending earnings delivered on or before this IST date. */
  through: IsoDate;
  /** Bank UTR / reference. */
  reference: string;
  /** "ops" or admin user id. */
  recordedBy: string;
  now: Date;
}

/** Marks pending earnings settled and records a SettlementDoc. Null when nothing is pending. */
export async function recordSettlement(_i: SettleInput): Promise<SettlementDoc | null> {
  throw new DomainError("not_implemented");
}

/** Admin overview: per-agency pending totals. */
export async function pendingSettlementsByAgency(): Promise<Array<{ agencyId: string; agencyName: string; pendingAmount: number; pendingCount: number; oldestDeliveredAt: string }>> {
  throw new DomainError("not_implemented");
}
