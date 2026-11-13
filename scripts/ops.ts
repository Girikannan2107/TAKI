/**
 * `npm run ops -- <command> [args]` — operator CLI (P2 §11). Every command goes through the
 * same services as the app and writes audit fields (reviewedBy / recordedBy = "ops").
 *
 *   agency:verify <agencyId>
 *   agency:reject <agencyId> --reason "<text>"
 *   driver:verify <driverId>
 *   driver:reject <driverId> --reason "<text>"
 *   settle --agency <agencyId> --through <YYYY-MM-DD> --reference <UTR>
 *   settlements:pending                      per-agency pending totals
 *   check-invariants                         capacity ledger check on every active trip
 *   jobs:retry <jobId>                       make a failed outbox job runnable again
 *   user:disable <userId>                    disable an account and revoke its sessions
 */
import { capacityInvariant } from "@/lib/domain/capacity";
import { revokeUserSessions } from "@/server/auth/sessions";
import { pendingSettlementsByAgency, recordSettlement } from "@/server/core/earnings";
import { retryJob } from "@/server/core/jobs";
import { verification } from "@/server/core/verification";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { BookingDoc, TripDoc, UserDoc } from "@/server/db/schema";

const [command, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
function positional(): string {
  const v = rest.find((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--")));
  if (!v) usage();
  return v;
}
function usage(): never {
  console.error(
    [
      "Usage: npm run ops -- <command>",
      "  agency:verify <agencyId> | agency:reject <agencyId> --reason <text>",
      "  driver:verify <driverId> | driver:reject <driverId> --reason <text>",
      "  settle --agency <agencyId> --through <YYYY-MM-DD> --reference <UTR>",
      "  settlements:pending | check-invariants | jobs:retry <jobId> | user:disable <userId>",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const now = new Date();
  const r = { now, reviewerId: "ops" };
  switch (command) {
    case "agency:verify": {
      const a = await verification.verifyAgency(r, positional());
      console.log(`✓ ${a.agencyName} is ${a.verification.status}`);
      return;
    }
    case "agency:reject": {
      const a = await verification.rejectAgency(r, positional(), flag("reason") ?? "");
      console.log(`✓ ${a.agencyName} is ${a.verification.status}: ${a.verification.reason}`);
      return;
    }
    case "driver:verify": {
      const d = await verification.verifyDriver(r, positional());
      console.log(`✓ ${d.fullName} documents ${d.verification.status}`);
      return;
    }
    case "driver:reject": {
      const d = await verification.rejectDriver(r, positional(), flag("reason") ?? "");
      console.log(`✓ ${d.fullName} documents ${d.verification.status}: ${d.verification.reason}`);
      return;
    }
    case "settle": {
      const agencyId = flag("agency");
      const through = flag("through");
      const reference = flag("reference");
      if (!agencyId || !through || !reference) usage();
      const s = await recordSettlement({ agencyId, through, reference, recordedBy: "ops", now });
      console.log(s ? `✓ Settlement ${s.id}: ₹${s.amount} for ${s.earningIds.length} deliveries (ref ${s.reference})` : "Nothing pending for that agency and date.");
      return;
    }
    case "settlements:pending": {
      const rows = await pendingSettlementsByAgency();
      if (rows.length === 0) console.log("No pending earnings.");
      for (const x of rows) console.log(`${x.agencyId}  ${x.agencyName.padEnd(28)} ₹${x.pendingAmount} (${x.pendingCount}) oldest ${x.oldestDeliveredAt}`);
      return;
    }
    case "check-invariants": {
      const store = getDocStore();
      const trips = await store.query<TripDoc>(C.trips, { where: [["status", "in", ["published", "in_progress"]]] });
      let bad = 0;
      for (const t of trips) {
        const bookings = await store.query<BookingDoc>(C.bookings, { where: [["tripId", "==", t.id]] });
        const problems = capacityInvariant(t, bookings, now);
        if (problems.length) {
          bad += 1;
          console.log(`✗ ${t.id}: ${problems.join("; ")}`);
        }
      }
      console.log(bad ? `${bad} of ${trips.length} trips violate the capacity invariant.` : `✓ ${trips.length} active trips pass the capacity invariant.`);
      if (bad) process.exitCode = 1;
      return;
    }
    case "jobs:retry": {
      const j = await retryJob(positional(), now);
      console.log(`✓ job ${j.id} (${j.type}) is pending again; the next sweep runs it.`);
      return;
    }
    case "user:disable": {
      const id = positional();
      const store = getDocStore();
      const user = await store.get<UserDoc>(C.users, id);
      if (!user) throw new Error(`No user ${id}`);
      await store.batchWrite([{ op: "update", col: C.users, id, data: { status: "disabled", updatedAt: now.toISOString() } }]);
      const n = await revokeUserSessions(id, now);
      console.log(`✓ ${user.displayName} disabled; ${n} session(s) revoked.`);
      return;
    }
    default:
      usage();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(`✗ ${(e as { message?: string }).message ?? e}`);
    process.exit(1);
  },
);
