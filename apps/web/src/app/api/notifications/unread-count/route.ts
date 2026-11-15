import type { UnreadCountResponse } from "@/lib/api/contracts/notifications";
import { unreadCount } from "@/server/core/notify";
import { getDocStore } from "@/server/db";
import { handler } from "@/server/http/handler";

/** GET /api/notifications/unread-count — `{ count }` (aggregate count; the client polls while visible). */
export const GET = handler({ auth: "any" }, async ({ session }): Promise<UnreadCountResponse> => ({ count: await unreadCount(getDocStore(), session.userId) }));
