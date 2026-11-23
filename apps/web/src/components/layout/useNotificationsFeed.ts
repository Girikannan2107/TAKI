"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationDTO } from "@/lib/api/contracts/common";
import { notificationsApi } from "@/lib/api/client/notifications";
import { errorMessage } from "@/lib/api/http";

const POLL_MS = 30_000;
const LIST_LIMIT = 12;

export type NotificationsListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: NotificationDTO[] };

export interface NotificationsFeed {
  unreadCount: number;
  list: NotificationsListState;
  /** (Re)loads the newest notifications — call when the panel opens. */
  loadList(): void;
  /** Optimistically marks one unread notification as read. */
  markRead(n: NotificationDTO): void;
  markAllRead(): void;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * The signed-in user's notifications (GET /api/notifications*). Polls the unread count every 30 s while
 * the tab is visible (and on returning to it); the list loads on demand. Inactive when `enabled` is false.
 */
export function useNotificationsFeed(enabled: boolean): NotificationsFeed {
  const [unreadCount, setUnreadCount] = useState(0);
  const [list, setList] = useState<NotificationsListState>({ status: "idle" });
  const countAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);

  const refreshCount = useCallback(() => {
    countAbort.current?.abort();
    const ctrl = new AbortController();
    countAbort.current = ctrl;
    notificationsApi
      .unreadCount(ctrl.signal)
      .then((r) => {
        if (!ctrl.signal.aborted) setUnreadCount(r.count);
      })
      .catch(() => {
        // Keep the last known count; the next poll retries.
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(refreshCount, 0);
    const timer = window.setInterval(() => {
      if (isVisible()) refreshCount();
    }, POLL_MS);
    const onVisible = () => {
      if (isVisible()) refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      countAbort.current?.abort();
      listAbort.current?.abort();
      // Signed out (or switched account): never show the previous user's notifications.
      setUnreadCount(0);
      setList({ status: "idle" });
    };
  }, [enabled, refreshCount]);

  const loadList = useCallback(() => {
    if (!enabled) return;
    listAbort.current?.abort();
    const ctrl = new AbortController();
    listAbort.current = ctrl;
    setList((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    notificationsApi
      .list({ limit: LIST_LIMIT }, ctrl.signal)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setList({ status: "ready", items: page.items });
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setList({ status: "error", message: errorMessage(e, "We couldn't load your notifications.") });
      });
    refreshCount();
  }, [enabled, refreshCount]);

  const markRead = useCallback(
    (n: NotificationDTO) => {
      if (n.readAt) return;
      const now = new Date().toISOString();
      setList((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)) } : prev));
      setUnreadCount((c) => Math.max(0, c - 1));
      void notificationsApi.markRead([n.id]).catch(refreshCount);
    },
    [refreshCount],
  );

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setList((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.map((n) => (n.readAt ? n : { ...n, readAt: now })) } : prev));
    setUnreadCount(0);
    void notificationsApi
      .markAllRead()
      .catch(() => loadList())
      .finally(refreshCount);
  }, [loadList, refreshCount]);

  return { unreadCount: enabled ? unreadCount : 0, list: enabled ? list : { status: "idle" }, loadList, markRead, markAllRead };
}
