import type { NotificationDTO, Page } from "@/lib/api/contracts/common";
import { NotificationsQuery } from "@/lib/api/contracts/notifications";
import { listNotifications } from "@/server/core/notify";
import { getDocStore } from "@/server/db";
import { decodeCursor, pageOf } from "@/server/http/cursor";
import { handler } from "@/server/http/handler";
import { toNotificationDTO } from "@/server/views/common";

/** GET /api/notifications?cursor&limit&unreadOnly — the caller's notifications, newest first. */
export const GET = handler({ auth: "any", query: NotificationsQuery }, async ({ session, query }): Promise<Page<NotificationDTO>> => {
  const rows = await listNotifications(getDocStore(), session.userId, { limit: query.limit + 1, startAfter: decodeCursor(query.cursor), unreadOnly: query.unreadOnly });
  const page = pageOf(rows, query.limit, (n) => [n.createdAt, n.id]);
  return { items: page.items.map(toNotificationDTO), nextCursor: page.nextCursor };
});
