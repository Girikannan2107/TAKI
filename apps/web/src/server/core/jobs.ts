import "server-only";
/**
 * Outbox jobs (P2 §0.9, §6.5): refunds and SMS are queued in the business transaction
 * and executed after commit (scheduleAfter) and by the sweep with exponential backoff
 * (1, 5, 15, 60… min; JOB_MAX_ATTEMPTS, then `failed` + an ops alert log).
 *
 * A claimed job is leased (`running`, nextAttemptAt = now + lease) so a crashed runner's
 * job is picked up again by a later sweep.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { JOB_BACKOFF_MINUTES, JOB_MAX_ATTEMPTS } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import { getSmsProvider } from "../auth/sms";
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { JobDoc, PaymentDoc, RefundJobPayload, SmsJobPayload } from "../db/schema";
import { scheduleAfter } from "../http/after";
import { gatewayFor } from "../payments/gateway";
import { notify } from "./notify";

const LEASE_MINUTES = 10;

export function enqueueJob(tx: TxContext, type: "refund", payload: RefundJobPayload, now: Date): JobDoc;
export function enqueueJob(tx: TxContext, type: "sms", payload: SmsJobPayload, now: Date): JobDoc;
export function enqueueJob(tx: TxContext, type: JobDoc["type"], payload: JobDoc["payload"], now: Date): JobDoc {
  const at = now.toISOString();
  const job: JobDoc = { id: newId("job"), type, payload, status: "pending", attempts: 0, nextAttemptAt: at, lastError: null, createdAt: at, updatedAt: at };
  tx.create(C.jobs, job.id, job);
  return job;
}

const plusMinutes = (now: Date, m: number) => new Date(now.getTime() + m * 60_000).toISOString();

function backoff(attempts: number): number {
  return JOB_BACKOFF_MINUTES[Math.min(attempts - 1, JOB_BACKOFF_MINUTES.length - 1)] ?? 60;
}

/** Claim a due job (pending, or running with an expired lease). Null when not claimable. */
async function claim(jobId: string, now: Date): Promise<JobDoc | null> {
  return getDocStore().runTransaction(async (tx) => {
    const job = await tx.get<JobDoc>(C.jobs, jobId);
    if (!job) return null;
    if (job.status !== "pending" && job.status !== "running") return null;
    if (Date.parse(job.nextAttemptAt) > now.getTime()) return null;
    const claimed: JobDoc = { ...job, status: "running", attempts: job.attempts + 1, nextAttemptAt: plusMinutes(now, LEASE_MINUTES), updatedAt: now.toISOString() };
    tx.set(C.jobs, job.id, claimed);
    return claimed;
  });
}

type Outcome = { kind: "done" } | { kind: "wait"; note: string } | { kind: "error"; error: string };

/**
 * Apply a refund result to the payment (and finish the job). Used by the job runner and by
 * the Cashfree REFUND_STATUS webhook. Idempotent.
 */
export async function applyRefundResult(
  paymentId: string,
  result: { status: "pending" | "succeeded" | "failed"; providerRefundId: string | null },
  now: Date,
  opts: { jobId?: string; final?: boolean } = {},
): Promise<PaymentDoc | null> {
  return getDocStore().runTransaction(async (tx) => {
    const p = await tx.get<PaymentDoc>(C.payments, paymentId);
    if (!p || !p.refund) return p;
    if (p.status === "refunded") return p;
    const at = now.toISOString();
    if (result.status === "succeeded") {
      const next: PaymentDoc = {
        ...p,
        status: "refunded",
        refund: { ...p.refund, status: "succeeded", completedAt: at, providerRefundId: result.providerRefundId ?? p.refund.providerRefundId },
        updatedAt: at,
        version: p.version + 1,
      };
      tx.set(C.payments, p.id, next);
      notify(
        tx,
        {
          userId: p.customerId,
          role: "customer",
          kind: "payment_refunded",
          title: "Refund completed",
          body: `₹${Math.round(p.refund.amountPaise / 100)} for ${p.bookingId} was refunded to your original payment method.`,
          link: { type: "booking", id: p.bookingId },
        },
        now,
      );
      return next;
    }
    if (result.status === "failed" && opts.final) {
      const next: PaymentDoc = { ...p, status: "refund_failed", refund: { ...p.refund, status: "failed" }, updatedAt: at, version: p.version + 1 };
      tx.set(C.payments, p.id, next);
      return next;
    }
    return p;
  });
}

async function execRefund(job: JobDoc, now: Date): Promise<Outcome> {
  const payload = job.payload as RefundJobPayload;
  const p = await getDocStore().get<PaymentDoc>(C.payments, payload.paymentId);
  if (!p || !p.refund) return { kind: "error", error: "payment_or_refund_missing" };
  if (p.status === "refunded") return { kind: "done" };
  const gw = gatewayFor(p.provider);
  let status: "pending" | "succeeded" | "failed" | null = null;
  let providerRefundId: string | null = null;
  if (job.attempts > 1) {
    // A previous attempt may have reached the gateway: ask before re-creating (Cashfree rejects duplicate refund ids).
    status = await gw.fetchRefundStatus({ paymentId: p.id, refundId: payload.refundId }).catch(() => null);
  }
  if (status === null || status === "failed") {
    const r = await gw.refund({ paymentId: p.id, refundId: payload.refundId, amountPaise: payload.amountPaise, reason: payload.reason });
    status = r.status;
    providerRefundId = r.providerRefundId;
  }
  if (status === "succeeded") {
    await applyRefundResult(p.id, { status, providerRefundId }, now, { jobId: job.id });
    return { kind: "done" };
  }
  if (status === "pending") return { kind: "wait", note: "refund pending at gateway" };
  return { kind: "error", error: "refund_failed_at_gateway" };
}

async function execSms(job: JobDoc): Promise<Outcome> {
  const p = job.payload as SmsJobPayload;
  await getSmsProvider().sendText({ to: p.to, templateId: p.templateId, vars: p.vars });
  return { kind: "done" };
}

/** Run one job by id (claims it first). Returns the job's resulting status. */
export async function runJob(jobId: string, now: Date): Promise<JobDoc["status"] | "skipped"> {
  const job = await claim(jobId, now);
  if (!job) return "skipped";
  let outcome: Outcome;
  try {
    outcome = job.type === "refund" ? await execRefund(job, now) : await execSms(job);
  } catch (e) {
    outcome = { kind: "error", error: e instanceof DomainError ? e.code : e instanceof Error ? e.name : "error" };
  }
  const at = now.toISOString();
  const store = getDocStore();
  let status: JobDoc["status"];
  let patch: Partial<JobDoc>;
  if (outcome.kind === "done") {
    status = "succeeded";
    patch = { status, lastError: null };
  } else if (outcome.kind === "wait") {
    status = "pending";
    patch = { status, nextAttemptAt: plusMinutes(now, backoff(Math.min(job.attempts, 4))), lastError: outcome.note };
  } else if (job.attempts >= JOB_MAX_ATTEMPTS) {
    status = "failed";
    patch = { status, lastError: outcome.error };
    console.error(`[taki] OPS ALERT: job ${job.id} (${job.type}) failed after ${job.attempts} attempts: ${outcome.error}`);
    if (job.type === "refund") await applyRefundResult((job.payload as RefundJobPayload).paymentId, { status: "failed", providerRefundId: null }, now, { final: true });
  } else {
    status = "pending";
    patch = { status, nextAttemptAt: plusMinutes(now, backoff(job.attempts)), lastError: outcome.error };
  }
  await store.batchWrite([{ op: "update", col: C.jobs, id: job.id, data: { ...patch, updatedAt: at } }]);
  return status;
}

/**
 * After commit: run these jobs right away (the sweep retries failures). `now` is the command's
 * clock; the later of it and the wall clock is used so a job is always claimable.
 */
export function runJobsAfterCommit(jobIds: readonly string[], now: Date): void {
  if (jobIds.length === 0) return;
  const at = () => new Date(Math.max(now.getTime(), Date.now()));
  for (const id of jobIds) scheduleAfter(() => runJob(id, at()));
}

/** Run up to `limit` due jobs (pending, or running with an expired lease). Returns how many ran. */
export async function runDueJobs(now: Date, limit = 20): Promise<number> {
  const due = await getDocStore().query<JobDoc>(C.jobs, {
    where: [
      ["status", "in", ["pending", "running"]],
      ["nextAttemptAt", "<=", now.toISOString()],
    ],
    orderBy: [["nextAttemptAt", "asc"]],
    limit,
  });
  let ran = 0;
  for (const j of due) {
    const r = await runJob(j.id, now);
    if (r !== "skipped") ran += 1;
  }
  return ran;
}

/** Ops: make a failed job runnable again (`npm run ops -- jobs:retry <jobId>`). */
export async function retryJob(jobId: string, now: Date): Promise<JobDoc> {
  return getDocStore().runTransaction(async (tx) => {
    const job = await tx.get<JobDoc>(C.jobs, jobId);
    if (!job) throw new DomainError("not_found");
    const next: JobDoc = { ...job, status: "pending", attempts: 0, nextAttemptAt: now.toISOString(), updatedAt: now.toISOString() };
    tx.set(C.jobs, job.id, next);
    return next;
  });
}
