"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Bell, ChevronDown, LogOut, RotateCcw, UserRound } from "lucide-react";
import { loginFor, paths, profileFor, type AppRole } from "@/lib/config/routes";
import type { NotificationLink } from "@/lib/domain/model";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { Avatar, initialsOf } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useLogout } from "./useLogout";
import { useNotificationsFeed } from "./useNotificationsFeed";
import { usePopover } from "./usePopover";
import { useShellSession } from "./useShellSession";

/** Where a notification opens for the signed-in role (null = not a link). */
export function notificationHref(role: AppRole | null, link: NotificationLink | null): string | null {
  if (!role || !link) return null;
  switch (link.type) {
    case "booking":
      if (role === "customer") return paths.customer.tracking(link.id);
      if (role === "agency") return paths.agency.booking(link.id);
      if (role === "driver") return paths.driver.shipment(link.id);
      return null;
    case "trip":
      if (role === "agency") return paths.agency.trip(link.id);
      if (role === "driver") return paths.driver.trip(link.id);
      return null;
    case "driver":
      if (role === "agency") return paths.agency.driver(link.id);
      if (role === "admin") return paths.admin.driver(link.id);
      return null;
    case "profile":
      if (role === "admin") return link.id.startsWith("agc_") ? paths.admin.agency(link.id) : paths.admin.driver(link.id);
      if (role === "agency") return paths.agency.verification();
      return profileFor(role);
    case "earnings":
      if (role === "agency") return paths.agency.earnings();
      if (role === "admin") return paths.admin.settlements;
      return null;
  }
}

export interface TopBarProps {
  /** Greeting / page title rendered as the page <h1>, e.g. "Hi, Arjun". */
  title?: ReactNode;
  /** Decorative emoji after the title (aria-hidden), e.g. "👋". */
  emoji?: string;
  subtitle?: string;
  /** Optional actions aligned right of the title (e.g. a primary button). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Dashboard greeting row: h1 + subtitle (+ optional actions). The notifications bell and the
 * account menu live in the app header (AppHeader), not here.
 */
export function TopBar({ title, emoji, subtitle, actions, className }: TopBarProps) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start gap-3 lg:mb-8", className)}>
      <div className="min-w-0 flex-1 pt-1">
        {title ? (
          <h1 className="type-h1 text-heading">
            {title}
            {emoji ? (
              <span aria-hidden="true" className="ml-2 inline-block">
                {emoji}
              </span>
            ) : null}
          </h1>
        ) : null}
        {subtitle ? <p className="mt-1 text-base text-ink-muted lg:text-lg">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Guest controls for the app header: Log in + Sign up. */
export function GuestActions({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { role } = useShellSession();
  const pathname = usePathname();
  const r = role ?? (pathname.startsWith("/agency") ? "agency" : pathname.startsWith("/driver") ? "driver" : "customer");
  return (
    <div className="flex items-center gap-2">
      <ButtonLink href={loginFor(r, pathname)} variant={tone === "dark" ? "ghost-dark" : "outline"} size="sm">
        Log in
      </ButtonLink>
      <ButtonLink href={paths.signup(r === "admin" ? "customer" : r)} size="sm" variant={tone === "dark" ? "lime" : "primary"} className="max-sm:hidden">
        Sign up
      </ButtonLink>
    </div>
  );
}

/** Notifications + account menu for the signed-in user (header right side). */
export function SignedInActions({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { user, role } = useShellSession();
  const logout = useLogout();
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <NotificationsButton tone={tone} />
      <AccountMenu user={user ?? { name: "TAKI user" }} profileHref={profileFor(role ?? "customer")} onLogout={logout} tone={tone} />
    </div>
  );
}

function NotificationsButton({ countOverride, tone = "light" }: { countOverride?: number; tone?: "light" | "dark" }) {
  const { role, ready, signedIn } = useShellSession();
  const feed = useNotificationsFeed(ready && signedIn);
  const { unreadCount, markAllRead, list } = feed;
  const { open, setOpen, triggerRef, panelRef } = usePopover<HTMLButtonElement>();
  const panelId = useId();
  const count = countOverride ?? unreadCount;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        ref={triggerRef}
        label={label}
        icon={<Bell strokeWidth={1.75} />}
        badge={count > 0 ? true : undefined}
        className={tone === "dark" ? "text-white hover:bg-white/10 [&>span]:ring-sage-900" : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) feed.loadList();
          setOpen(!open);
        }}
      />
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        role="region"
        aria-label="Notifications"
        aria-busy={list.status === "loading" || undefined}
        className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-lg border border-border bg-surface shadow-raised motion-safe:animate-pop-in -mr-14 sm:mr-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-heading text-[15px] font-semibold text-ink">Notifications</h2>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-sm text-sm font-medium text-green-700 underline-offset-2 hover:underline pointer-coarse:min-h-11"
            >
              Mark all as read
            </button>
          ) : null}
        </div>
        {list.status === "idle" || list.status === "loading" ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <span className="sr-only">Loading notifications…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            ))}
          </div>
        ) : list.status === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-1 px-4 py-6 text-center text-sm text-ink-muted">
            <p>{list.message}</p>
            <button
              type="button"
              onClick={feed.loadList}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-green-700 underline-offset-2 hover:underline"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Try again
            </button>
          </div>
        ) : list.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">You&apos;re all caught up.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {list.items.map((n) => {
              const href = notificationHref(role, n.link);
              const body = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.readAt ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-green-600" aria-hidden="true" />
                    ) : (
                      <span className="mt-1.5 size-2 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">
                        {!n.readAt ? <span className="sr-only">Unread: </span> : null}
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{n.body}</span>
                      <span className="mt-1 block text-caption text-ink-subtle">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        feed.markRead(n);
                        setOpen(false);
                      }}
                      className="block px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:-outline-offset-2"
                    >
                      {body}
                    </Link>
                  ) : !n.readAt ? (
                    <button
                      type="button"
                      onClick={() => feed.markRead(n)}
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:-outline-offset-2"
                    >
                      {body}
                      <span className="sr-only"> (mark as read)</span>
                    </button>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function AccountMenu({
  user,
  profileHref,
  onLogout,
  tone = "light",
}: {
  user: { name: string; avatarUrl?: string };
  profileHref: string;
  onLogout(): void;
  tone?: "light" | "dark";
}) {
  const { open, setOpen, close, triggerRef, panelRef } = usePopover<HTMLButtonElement>();
  const menuId = useId();
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  function focusItem(i: number) {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[];
    if (items.length === 0) return;
    items[(i + items.length) % items.length].focus();
  }

  function openMenu(focusIndex = 0) {
    setOpen(true);
    // Wait for the panel to un-hide before moving focus into it.
    requestAnimationFrame(() => focusItem(focusIndex));
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(-1);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[];
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  const itemClass =
    "flex h-11 w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:-outline-offset-2";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        // Name starts with the visible initials (WCAG 2.5.3 Label in Name).
        aria-label={`${initialsOf(user.name)}, Account menu for ${user.name}`}
        onClick={() => (open ? setOpen(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex h-11 items-center gap-2 rounded-full pl-0.5 pr-1.5 transition-colors",
          tone === "dark" ? "text-white hover:bg-white/10" : "hover:bg-ink/6",
        )}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" decorative />
        <span className={cn("hidden max-w-[10rem] truncate font-heading text-[15px] font-semibold xl:block", tone === "dark" ? "text-white" : "text-ink")} aria-hidden="true">
          {user.name}
        </span>
        <ChevronDown aria-hidden="true" strokeWidth={1.75} className={cn("hidden size-4 sm:block", tone === "dark" ? "text-white/90" : "text-ink-muted")} />
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label="Account"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-raised motion-safe:animate-pop-in"
      >
        <p className="truncate border-b border-border px-4 pb-2 pt-2 text-sm font-semibold text-ink" role="presentation">
          {user.name}
        </p>
        <Link
          ref={(el) => {
            itemRefs.current[0] = el;
          }}
          href={profileHref}
          role="menuitem"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className={itemClass}
        >
          <UserRound aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-700" />
          Profile
        </Link>
        <button
          ref={(el) => {
            itemRefs.current[1] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            setOpen(false);
            onLogout();
          }}
          className={itemClass}
        >
          <LogOut aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-700" />
          Log out
        </button>
      </div>
    </div>
  );
}
