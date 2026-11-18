import { MarkReadBody } from "@/lib/api/contracts/notifications";
import { markRead } from "@/server/core/notify";
import { getDocStore } from "@/server/db";
import { handler } from "@/server/http/handler";

/** POST /api/notifications/read `{ ids }` or `{ all: true }` — 204. Only the caller's own notifications change. */
export const POST = handler({ auth: "any", body: MarkReadBody }, async ({ session, body, now }) => {
  await markRead(getDocStore(), session.userId, "all" in body ? { all: true } : { ids: body.ids }, now);
});
