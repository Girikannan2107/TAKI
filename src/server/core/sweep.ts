import "server-only";
/** Expiry sweep (P2 §6.5): stale requests, unpaid holds, due jobs. Correctness never depends on it. */
import { DomainError } from "@/lib/api/contracts/errors";

export interface SweepResult {
  expiredRequests: number;
  expiredPayments: number;
  jobsRun: number;
}

export async function runSweep(_now: Date): Promise<SweepResult> {
  throw new DomainError("not_implemented");
}
