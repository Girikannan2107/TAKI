import { DomainError } from "@/lib/api/contracts/errors";
import { runSweep } from "@/server/core/sweep";
import { env } from "@/server/env";
import { safeEqual } from "@/server/http/crypto";
import { handler } from "@/server/http/handler";

/**
 * POST (or GET, which Vercel Cron sends) /api/internal/sweep with `Authorization: Bearer <CRON_SECRET>`:
 * expires stale requests and unpaid holds and runs due outbox jobs.
 * 401 without the right secret; 503 cron_not_configured when CRON_SECRET is unset.
 */
function authorize(req: Request): void {
  const secret = env().CRON_SECRET?.trim();
  if (!secret) throw new DomainError("cron_not_configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !safeEqual(token, secret)) throw new DomainError("unauthenticated");
}

const sweep = handler({ auth: "public", csrf: false }, async ({ req, now }) => {
  authorize(req);
  return runSweep(now);
});

export const POST = sweep;
export const GET = sweep;
