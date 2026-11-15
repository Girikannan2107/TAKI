/**
 * `npm run sweep` — run the expiry sweep once (stale requests, unpaid holds, due outbox jobs).
 * Production runs the same code every 5 min via POST /api/internal/sweep (Bearer CRON_SECRET).
 */
import { runSweep } from "@/server/core/sweep";
import { flushAfterTasks, queueAfterTasks } from "@/server/http/after";

async function main(): Promise<void> {
  queueAfterTasks(true);
  const r = await runSweep(new Date());
  await flushAfterTasks();
  console.log(`✓ sweep: ${r.expiredRequests} request(s) expired, ${r.expiredPayments} unpaid booking(s) released, ${r.jobsRun} job(s) run`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
