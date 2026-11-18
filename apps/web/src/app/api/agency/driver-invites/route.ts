import { DriverInviteBody } from "@/lib/api/contracts/agency";
import { created, handler } from "@/server/http/handler";
import { createInvite, listInvites } from "@/server/modules/agency/invites";

/** GET /api/agency/driver-invites → { items: InviteDTO[] } (pending) */
export const GET = handler({ auth: "agency" }, ({ session, now }) => listInvites(session, now));

/** POST /api/agency/driver-invites { fullName, phone } → 201 InviteDTO · 409 phone_taken / already_exists */
export const POST = handler(
  {
    auth: "agency",
    body: DriverInviteBody,
    rateLimit: { rule: { limit: 30, windowSeconds: 3600 }, bucket: ({ session }) => "agency:invite:user:" + (session?.userId ?? "anon") },
  },
  async ({ session, body, now }) => created(await createInvite(session, body, now)),
);
