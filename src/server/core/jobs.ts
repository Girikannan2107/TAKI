import "server-only";
/**
 * Outbox jobs (P2 §0.9, §6.5): refunds and SMS are queued in the business transaction
 * and executed after commit (scheduleAfter) and by the sweep with exponential backoff.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { newId } from "@/lib/domain/ids";
import { C } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { JobDoc, RefundJobPayload, SmsJobPayload } from "../db/schema";

export function enqueueJob(tx: TxContext, type: "refund", payload: RefundJobPayload, now: Date): JobDoc;
export function enqueueJob(tx: TxContext, type: "sms", payload: SmsJobPayload, now: Date): JobDoc;
export function enqueueJob(tx: TxContext, type: JobDoc["type"], payload: JobDoc["payload"], now: Date): JobDoc {
  const at = now.toISOString();
  const job: JobDoc = { id: newId("job"), type, payload, status: "pending", attempts: 0, nextAttemptAt: at, lastError: null, createdAt: at, updatedAt: at };
  tx.create(C.jobs, job.id, job);
  return job;
}

/** Run one job by id (claims it in a transaction first). */
export async function runJob(_jobId: string, _now: Date): Promise<JobDoc["status"]> {
  throw new DomainError("not_implemented");
}

/** Run up to `limit` due jobs. Returns how many ran. */
export async function runDueJobs(_now: Date, _limit = 20): Promise<number> {
  throw new DomainError("not_implemented");
}
