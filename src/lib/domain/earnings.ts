/** Driver earnings & dashboard stats (data-contract.md §11.6). Pure, derived — never stored. */
import { monthKey, shiftMonth } from "./dates";
import type { Db } from "./db";
import { CAPACITY_HOLDING } from "./legacy/booking-machine";
import { hasDeparted, routeDepartureMs } from "./search";
import type { DriverDashboardStats, EarningEntry, EarningsSummary, Id, Payout } from "./types";

export function driverEarningEntries(db: Db, driverId: Id): EarningEntry[] {
  return Object.values(db.earnings)
    .filter((e) => e.driverId === driverId)
    .sort((a, b) => b.creditedAt.localeCompare(a.creditedAt));
}

export function driverPayouts(db: Db, driverId: Id): Payout[] {
  return Object.values(db.payouts)
    .filter((p) => p.driverId === driverId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

function amountForMonth(db: Db, driverId: Id, key: string): number {
  const live = driverEarningEntries(db, driverId)
    .filter((e) => monthKey(e.creditedAt) === key)
    .reduce((s, e) => s + e.amount, 0);
  const archived = db.archivedMonths.filter((m) => m.driverId === driverId && m.month === key).reduce((s, m) => s + m.amount, 0);
  return live + archived;
}

export function earningsSummary(db: Db, driverId: Id, now: Date): EarningsSummary {
  const current = monthKey(now);
  const thisMonth = amountForMonth(db, driverId, current);
  const lastMonth = amountForMonth(db, driverId, shiftMonth(current, -1));
  const total =
    driverEarningEntries(db, driverId).reduce((s, e) => s + e.amount, 0) +
    db.archivedMonths.filter((m) => m.driverId === driverId).reduce((s, m) => s + m.amount, 0);
  const paidOut = driverPayouts(db, driverId)
    .filter((p) => p.status !== "failed")
    .reduce((s, p) => s + p.amount, 0);
  const monthlySeries = [-5, -4, -3, -2, -1, 0].map((d) => {
    const month = shiftMonth(current, d);
    return { month, amount: amountForMonth(db, driverId, month) };
  });
  return {
    availableForPayout: Math.max(0, total - paidOut),
    thisMonth,
    lastMonth,
    total,
    changePctVsLastMonth: lastMonth === 0 ? null : Math.round(((thisMonth - lastMonth) / lastMonth) * 100),
    monthlySeries,
  };
}

export function driverDashboardStats(db: Db, driverId: Id, now: Date): DriverDashboardStats {
  const summary = earningsSummary(db, driverId, now);
  const routes = Object.values(db.routes).filter((r) => r.driverId === driverId);
  const activeRoutes = routes.filter((r) => r.status === "published").length;
  const pendingRequests = Object.values(db.bookings).filter((b) => b.driverId === driverId && b.status === "awaiting_driver").length;
  const completedTrips =
    routes.filter((r) => r.status === "completed").length +
    db.archivedMonths.filter((m) => m.driverId === driverId).reduce((s, m) => s + m.completedRoutes, 0);
  const next = routes
    .filter((r) => r.status === "published" && !hasDeparted(r, now))
    .sort((a, b) => routeDepartureMs(a) - routeDepartureMs(b))[0];
  return {
    earningsThisMonth: summary.thisMonth,
    changePctVsLastMonth: summary.changePctVsLastMonth,
    activeRoutes,
    pendingRequests,
    completedTrips,
    nextRouteAvailableCapacityKg: next ? next.availableCapacityKg : null,
  };
}

/** Capacity invariant check (data-contract.md §6.1) — used by tests. */
export function capacityInvariantHolds(db: Db): boolean {
  return Object.values(db.routes).every((r) => {
    if (r.status === "completed" || r.status === "cancelled") return true;
    const held = Object.values(db.bookings)
      // Capacity is never released on delivery (§6.4), so delivered bookings still count.
      .filter((b) => b.routeId === r.id && (CAPACITY_HOLDING.includes(b.status) || b.status === "delivered"))
      .reduce((s, b) => s + b.shipment.weightKg, 0);
    return r.availableCapacityKg === r.offeredCapacityKg - held && r.availableCapacityKg >= 0 && r.offeredCapacityKg <= r.totalCapacityKg;
  });
}
