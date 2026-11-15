import "server-only";
/**
 * Earnings & settlements (owner decision: read-only settlements, no payouts).
 * Earnings are created on delivery (bookings.deliver) — one per delivered booking;
 * ops/admin record settlements (`npm run ops -- settle …` or the admin page).
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { isoDateFromInstant } from "@/lib/domain/dates";
import { newId } from "@/lib/domain/ids";
import type { IsoDate } from "@/lib/domain/model";
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { AgencyDoc, EarningDoc, PaymentDoc, SettlementDoc } from "../db/schema";
import { notify } from "./notify";

export interface AgencyEarningsReadModel {
  summary: { total: number; pending: number; settled: number; onHold: number; thisMonth: number; lastMonth: number };
  /** Last 6 IST months, oldest first. */
  monthlySeries: Array<{ month: string; amount: number }>;
  byTrip: Array<{ tripId: string; routeLabel: string; deliveredBookings: number; agencyNet: number; lastDeliveredAt: string }>;
  byBooking: EarningDoc[];
  payments: PaymentDoc[];
  settlements: SettlementDoc[];
}

/** "2026-11" for an instant, in IST. */
export function istMonth(instant: string | Date): string {
  return isoDateFromInstant(instant instanceof Date ? instant.toISOString() : instant).slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Pure aggregation (exported for tests). */
export function aggregateEarnings(earnings: readonly EarningDoc[], now: Date): Pick<AgencyEarningsReadModel, "summary" | "monthlySeries" | "byTrip"> {
  const thisMonth = istMonth(now);
  const lastMonth = shiftMonth(thisMonth, -1);
  const summary = { total: 0, pending: 0, settled: 0, onHold: 0, thisMonth: 0, lastMonth: 0 };
  const months = new Map<string, number>();
  for (let k = 5; k >= 0; k--) months.set(shiftMonth(thisMonth, -k), 0);
  const trips = new Map<string, AgencyEarningsReadModel["byTrip"][number]>();
  for (const e of earnings) {
    summary.total += e.agencyNet;
    if (e.status === "pending") summary.pending += e.agencyNet;
    else if (e.status === "settled") summary.settled += e.agencyNet;
    else summary.onHold += e.agencyNet;
    const m = istMonth(e.deliveredAt);
    if (m === thisMonth) summary.thisMonth += e.agencyNet;
    if (m === lastMonth) summary.lastMonth += e.agencyNet;
    if (months.has(m)) months.set(m, months.get(m)! + e.agencyNet);
    const t = trips.get(e.tripId) ?? { tripId: e.tripId, routeLabel: e.routeLabel, deliveredBookings: 0, agencyNet: 0, lastDeliveredAt: e.deliveredAt };
    t.deliveredBookings += 1;
    t.agencyNet += e.agencyNet;
    if (e.deliveredAt > t.lastDeliveredAt) t.lastDeliveredAt = e.deliveredAt;
    trips.set(e.tripId, t);
  }
  return {
    summary,
    monthlySeries: [...months].map(([month, amount]) => ({ month, amount })),
    byTrip: [...trips.values()].sort((a, b) => b.lastDeliveredAt.localeCompare(a.lastDeliveredAt)),
  };
}

export async function agencyEarnings(agencyId: string, range: { from?: IsoDate; to?: IsoDate }, now: Date): Promise<AgencyEarningsReadModel> {
  const store = getDocStore();
  const [all, payments, settlements] = await Promise.all([
    store.query<EarningDoc>(C.earnings, { where: [["agencyId", "==", agencyId]], orderBy: [["deliveredAt", "desc"]], limit: 2000 }),
    store.query<PaymentDoc>(C.payments, { where: [["agencyId", "==", agencyId]], orderBy: [["createdAt", "desc"]], limit: 100 }),
    store.query<SettlementDoc>(C.settlements, { where: [["agencyId", "==", agencyId]], orderBy: [["settledAt", "desc"]], limit: 50 }),
  ]);
  const inRange = all.filter((e) => {
    const d = isoDateFromInstant(e.deliveredAt);
    return (!range.from || d >= range.from) && (!range.to || d <= range.to);
  });
  const agg = aggregateEarnings(inRange, now);
  // Payments history: only money that actually moved (no abandoned checkouts).
  const moved = payments.filter((p) => p.status === "succeeded" || p.status.startsWith("refund"));
  return { ...agg, byBooking: inRange, payments: moved, settlements };
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

const MAX_PER_SETTLEMENT = 400;

/** Marks pending earnings settled and records a SettlementDoc. Null when nothing is pending. */
export async function recordSettlement(i: SettleInput): Promise<SettlementDoc | null> {
  const reference = i.reference.trim();
  if (reference.length < 3 || reference.length > 64) throw new DomainError("invalid_request", "Enter the bank reference (UTR).", { fields: { reference: "Required" } });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.through)) throw new DomainError("invalid_request", "Use a YYYY-MM-DD date.", { fields: { through: "Invalid date" } });
  const store = getDocStore();
  const candidates = await store.query<EarningDoc>(C.earnings, {
    where: [
      ["agencyId", "==", i.agencyId],
      ["status", "==", "pending"],
    ],
    orderBy: [["deliveredAt", "desc"]],
    limit: 2000,
  });
  const due = candidates.filter((e) => isoDateFromInstant(e.deliveredAt) <= i.through).slice(-MAX_PER_SETTLEMENT);
  if (due.length === 0) return null;
  return store.runTransaction(async (tx) => {
    const agency = await tx.get<AgencyDoc>(C.agencies, i.agencyId);
    if (!agency) throw new DomainError("not_found");
    const fresh = (await tx.getMany<EarningDoc>(C.earnings, due.map((e) => e.id))).filter((e): e is EarningDoc => !!e && e.status === "pending" && e.agencyId === i.agencyId);
    if (fresh.length === 0) return null;
    const at = i.now.toISOString();
    const settlement: SettlementDoc = {
      id: newId("stl"),
      agencyId: i.agencyId,
      amount: fresh.reduce((s, e) => s + e.agencyNet, 0),
      earningIds: fresh.map((e) => e.id),
      reference,
      periodThrough: i.through,
      settledAt: at,
      recordedBy: i.recordedBy,
      createdAt: at,
      updatedAt: at,
    };
    tx.create(C.settlements, settlement.id, settlement);
    for (const e of fresh) tx.set(C.earnings, e.id, { ...e, status: "settled", settlementId: settlement.id, settledAt: at, updatedAt: at });
    notify(
      tx,
      {
        userId: agency.ownerUserId,
        role: "agency",
        kind: "settlement_recorded",
        title: "Settlement recorded",
        body: `₹${settlement.amount} for ${fresh.length} deliveries (through ${i.through}) was settled. Reference ${reference}.`,
        link: { type: "earnings", id: settlement.id },
      },
      i.now,
    );
    return settlement;
  });
}

/** Admin overview: per-agency pending totals. */
export async function pendingSettlementsByAgency(): Promise<Array<{ agencyId: string; agencyName: string; pendingAmount: number; pendingCount: number; oldestDeliveredAt: string }>> {
  const store = getDocStore();
  const pending = await store.query<EarningDoc>(C.earnings, { where: [["status", "==", "pending"]], limit: 5000 });
  const by = new Map<string, { pendingAmount: number; pendingCount: number; oldestDeliveredAt: string }>();
  for (const e of pending) {
    const a = by.get(e.agencyId) ?? { pendingAmount: 0, pendingCount: 0, oldestDeliveredAt: e.deliveredAt };
    a.pendingAmount += e.agencyNet;
    a.pendingCount += 1;
    if (e.deliveredAt < a.oldestDeliveredAt) a.oldestDeliveredAt = e.deliveredAt;
    by.set(e.agencyId, a);
  }
  const ids = [...by.keys()];
  const agencies = ids.length ? await store.getMany<AgencyDoc>(C.agencies, ids) : [];
  return ids
    .map((id, k) => ({ agencyId: id, agencyName: agencies[k]?.agencyName ?? id, ...by.get(id)! }))
    .sort((a, b) => a.oldestDeliveredAt.localeCompare(b.oldestDeliveredAt));
}
