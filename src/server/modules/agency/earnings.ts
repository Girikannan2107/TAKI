import "server-only";
/**
 * Agency Earnings (owner decision: read-only settlements). Data comes ONLY from D5's earnings
 * read model (`core.agencyEarnings`) — built from real delivered bookings, payments and ops
 * settlements. No withdraw action, nothing seeded or estimated here.
 */
import type { AgencyEarningsDTO } from "@/lib/api/contracts/agency";
import type { IsoDate } from "@/lib/domain/model";
import { agencyEarnings } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { agencyIdOf } from "./shared";

export async function getEarnings(session: SessionContext, range: { from?: IsoDate; to?: IsoDate }, now: Date): Promise<AgencyEarningsDTO> {
  const m = await agencyEarnings(agencyIdOf(session), range, now);
  return {
    summary: m.summary,
    monthlySeries: m.monthlySeries,
    byTrip: m.byTrip,
    byBooking: m.byBooking.map((e) => ({
      bookingId: e.bookingId,
      tripId: e.tripId,
      routeLabel: e.routeLabel,
      customerPaid: e.customerPaid,
      transportationCharge: e.transportationCharge,
      handlingFee: e.handlingFee,
      platformFee: e.platformFee,
      agencyNet: e.agencyNet,
      deliveredAt: e.deliveredAt,
      status: e.status,
      settledAt: e.settledAt,
    })),
    payments: m.payments.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      status: p.status,
      amountRupees: Math.round(p.amountPaise / 100),
      methodLabel: p.methodLabel,
      createdAt: p.createdAt,
      paidAt: p.confirmation && (p.status === "succeeded" || p.status.startsWith("refund")) ? p.confirmation.at : null,
    })),
    settlements: m.settlements.map((s) => ({
      id: s.id,
      amount: s.amount,
      bookings: s.earningIds.length,
      reference: s.reference,
      periodThrough: s.periodThrough,
      settledAt: s.settledAt,
    })),
  };
}
