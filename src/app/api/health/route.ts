import type { HealthDTO } from "@/lib/api/contracts/common";
import { docStoreKind } from "@/server/db";
import { env } from "@/server/env";
import { handler } from "@/server/http/handler";

/** GET /api/health — which backends this deployment uses (no secrets, no network calls). */
export const GET = handler({ auth: "public" }, (): HealthDTO => {
  const e = env();
  return { ok: true, store: docStoreKind(), payments: e.PAYMENT_PROVIDER, sms: e.SMS_PROVIDER };
});
