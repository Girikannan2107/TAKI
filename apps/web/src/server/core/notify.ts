import "server-only";
/**
 * In-app notifications (P2 §10), written INSIDE the business transaction so a state change
 * and its notification commit together. Also the read side for /api/notifications.
 */
import { newId } from "@/lib/domain/ids";
import type { NotificationKind, NotificationLink, Role } from "@/lib/domain/model";
import { C } from "../db/collections";
import type { DocStore, TxContext } from "../db/docstore";
import type { NotificationDoc } from "../db/schema";

export interface NotifyInput {
  userId: string;
  role: Role;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: NotificationLink | null;
}

export function buildNotification(i: NotifyInput, now: Date): NotificationDoc {
  return {
    id: newId("ntf"),
    userId: i.userId,
    role: i.role,
    kind: i.kind,
    title: i.title,
    body: i.body,
    link: i.link ?? null,
    createdAt: now.toISOString(),
    readAt: null,
  };
}

/** Queue a notification write on the transaction. Returns the doc. */
export function notify(tx: TxContext, i: NotifyInput, now: Date): NotificationDoc {
  const doc = buildNotification(i, now);
  tx.create(C.notifications, doc.id, doc);
  return doc;
}

export function notifyMany(tx: TxContext, list: readonly NotifyInput[], now: Date): void {
  const seen = new Set<string>();
  for (const i of list) {
    const key = `${i.userId}|${i.kind}`;
    if (seen.has(key)) continue; // one per recipient per kind per transaction
    seen.add(key);
    notify(tx, i, now);
  }
}

// ── Read side ────────────────────────────────────────────────────────────────
export async function listNotifications(
  store: DocStore,
  userId: string,
  opts: { limit: number; startAfter?: unknown[]; unreadOnly?: boolean },
): Promise<NotificationDoc[]> {
  return store.query<NotificationDoc>(C.notifications, {
    where: opts.unreadOnly ? [["userId", "==", userId], ["readAt", "==", null]] : [["userId", "==", userId]],
    orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
    limit: opts.limit,
    startAfter: opts.startAfter,
  });
}

export async function unreadCount(store: DocStore, userId: string): Promise<number> {
  return store.count(C.notifications, { where: [["userId", "==", userId], ["readAt", "==", null]] });
}

/** Mark specific ids (owned by the user) or all unread as read. Returns how many changed. */
export async function markRead(store: DocStore, userId: string, sel: { ids: readonly string[] } | { all: true }, now: Date): Promise<number> {
  const at = now.toISOString();
  if ("ids" in sel) {
    const docs = await store.getMany<NotificationDoc>(C.notifications, sel.ids);
    const mine = docs.filter((d): d is NotificationDoc => !!d && d.userId === userId && d.readAt === null);
    if (mine.length) await store.batchWrite(mine.map((d) => ({ op: "update" as const, col: C.notifications, id: d.id, data: { readAt: at } })));
    return mine.length;
  }
  let total = 0;
  for (;;) {
    const unread = await store.query<NotificationDoc>(C.notifications, { where: [["userId", "==", userId], ["readAt", "==", null]], limit: 400 });
    if (unread.length === 0) break;
    await store.batchWrite(unread.map((d) => ({ op: "update" as const, col: C.notifications, id: d.id, data: { readAt: at } })));
    total += unread.length;
    if (unread.length < 400) break;
  }
  return total;
}
