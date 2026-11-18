import "server-only";
/**
 * Expiry sweep (P2 §6.5): stale requests, unpaid holds, due jobs. Correctness never depends
 * on it (holds stop counting at dueAt; every booking transaction expires lazily) — the sweep
 * only makes the stored state, notifications and refunds catch up.
 *
 * Callers: POST /api/internal/sweep (Bearer CRON_SECRET), `npm run sweep`, and an
 * opportunistic throttled call (`maybeSweep`) from busy read endpoints.
 */
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { BookingDoc } from "../db/schema";
import { txn } from "./internal";
import { runDueJobs, runJob } from "./jobs";
import { applyExpiry, dueExpiry, readBundle } from "./lifecycle";

export interface SweepResult {
  expiredRequests: number;
  expiredPayments: number;
  jobsRun: number;
}

const BATCH = 100;

/** Expire one booking if (still) due, in its own transaction. Returns refund job ids, or null if nothing was due. */
export async function expireBookingIfDue(bookingId: string, now: Date): Promise<{ kind: "expireRequest" | "expirePayment"; refundJobIds: string[] } | null> {
  return txn(async (tx) => {
    const bundle = await readBundle(tx, bookingId);
    if (!bundle) return null;
    const kind = dueExpiry(bundle.booking, bundle.trip, bundle.payments, now);
    if (!kind) return null;
    const out = applyExpiry(tx, bundle, kind, now);
    return out ? { kind, refundJobIds: out.refundJobIds } : null;
  });
}

export async function runSweep(now: Date): Promise<SweepResult> {
  const store = getDocStore();
  const at = now.toISOString();
  const result: SweepResult = { expiredRequests: 0, expiredPayments: 0, jobsRun: 0 };
  const jobIds: string[] = [];

  const requests = await store.query<BookingDoc>(C.bookings, {
    where: [
      ["status", "==", "awaiting_agency"],
      ["respondBy", "<=", at],
    ],
    orderBy: [["respondBy", "asc"]],
    limit: BATCH,
  });
  for (const b of requests) {
    const r = await expireBookingIfDue(b.id, now).catch((e) => (console.error("[taki] sweep: request expiry failed", b.id, e), null));
    if (r) {
      result.expiredRequests += 1;
      jobIds.push(...r.refundJobIds);
    }
  }

  const unpaid = await store.query<BookingDoc>(C.bookings, {
    where: [
      ["status", "in", ["pending_payment", "payment_failed"]],
      ["paymentDueAt", "<=", at],
    ],
    orderBy: [["paymentDueAt", "asc"]],
    limit: BATCH,
  });
  for (const b of unpaid) {
    // Re-checks the hold's dueAt (checkout grace may have extended it) and recent checkouts.
    const r = await expireBookingIfDue(b.id, now).catch((e) => (console.error("[taki] sweep: payment expiry failed", b.id, e), null));
    if (r) {
      result.expiredPayments += 1;
      jobIds.push(...r.refundJobIds);
    }
  }

  for (const id of jobIds) if ((await runJob(id, now)) !== "skipped") result.jobsRun += 1;
  result.jobsRun += await runDueJobs(now);
  return result;
}

const g = globalThis as unknown as { __takiLastSweep?: number };

/** Opportunistic sweep, throttled to once a minute per instance. Never throws. */
export async function maybeSweep(now: Date): Promise<void> {
  const last = g.__takiLastSweep ?? 0;
  if (now.getTime() - last < 60_000) return;
  g.__takiLastSweep = now.getTime();
  await runSweep(now).catch((e) => console.error("[taki] opportunistic sweep failed", e));
}
