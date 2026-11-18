import "server-only";
/**
 * Agency dashboard read model (P2 §8.5 GET /api/agency/dashboard). Every number is a live count or
 * a sum over real `earnings` documents (created on delivery) — nothing estimated or seeded.
 */
import type { AgencyDashboardDTO } from "@/lib/api/contracts/agency";
import { monthKey, shiftMonth } from "@/lib/domain/dates";
import { listNotifications } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { EarningDoc, TripDoc } from "@/server/db/schema";
import { toAgencyTripListItem } from "@/server/views/agency";
import { toNotificationDTO } from "@/server/views/common";
import { agencyIdOf, loadAgency } from "./shared";

/** Revenue = Σ agencyNet of earnings (delivered bookings), by IST month. */
export function revenueOf(earnings: readonly Pick<EarningDoc, "agencyNet" | "deliveredAt">[], now: Date): AgencyDashboardDTO["revenue"] {
  const thisKey = monthKey(now);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(thisKey, i - 5));
  const byMonth = new Map(months.map((m) => [m, 0]));
  let total = 0;
  for (const e of earnings) {
    total += e.agencyNet;
    const k = monthKey(e.deliveredAt);
    if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! + e.agencyNet);
  }
  const thisMonth = byMonth.get(thisKey) ?? 0;
  const lastMonth = byMonth.get(shiftMonth(thisKey, -1)) ?? 0;
  return {
    thisMonth,
    lastMonth,
    total,
    changePct: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null,
    monthlySeries: months.map((m) => ({ month: m, amount: byMonth.get(m) ?? 0 })),
  };
}

export async function getDashboard(session: SessionContext, now: Date): Promise<AgencyDashboardDTO> {
  const agencyId = agencyIdOf(session);
  const store = getDocStore();
  const byAgency = ["agencyId", "==", agencyId] as const;
  const [agency, vehicles, drivers, pendingDrivers, active, upcoming, pending, delivered, earnings, upcomingTrips, activity] = await Promise.all([
    loadAgency(agencyId),
    store.count(C.vehicles, { where: [byAgency, ["status", "in", ["active", "inactive"]]] }),
    store.count(C.drivers, { where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", "active"]] }),
    store.count(C.drivers, { where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", "pending"]] }),
    store.count(C.trips, { where: [byAgency, ["status", "==", "in_progress"]] }),
    store.count(C.trips, { where: [byAgency, ["status", "==", "published"]] }),
    store.count(C.bookings, { where: [byAgency, ["status", "==", "awaiting_agency"]] }),
    store.count(C.bookings, { where: [byAgency, ["status", "==", "delivered"]] }),
    store.query<EarningDoc>(C.earnings, { where: [byAgency], orderBy: [["deliveredAt", "desc"], ["__name__", "desc"]], limit: 2000 }),
    store.query<TripDoc>(C.trips, { where: [byAgency, ["status", "==", "published"]], orderBy: [["departureAt", "asc"], ["__name__", "asc"]], limit: 3 }),
    listNotifications(store, session.userId, { limit: 8 }),
  ]);
  return {
    agency: {
      id: agency.id,
      name: agency.agencyName,
      ownerName: agency.ownerName,
      verification: agency.verification.status,
      verificationReason: agency.verification.reason,
    },
    totals: { vehicles, drivers, pendingDrivers },
    trips: { active, upcoming },
    pendingBookings: pending,
    completedShipments: delivered,
    revenue: revenueOf(earnings, now),
    upcomingTrips: upcomingTrips.map((t) => toAgencyTripListItem(t, now)),
    recentActivity: activity.map(toNotificationDTO),
  };
}
