"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Bell, ChevronDown, LogOut, Menu, UserRound } from "lucide-react";
import { loginFor, paths, profileFor, type AppRole } from "@/lib/config/routes";
import { formatDateTime } from "@/lib/format";
import { useNotifications } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { Avatar, initialsOf } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { useLogout } from "./useLogout";
import { usePopover } from "./usePopover";
import { useShellSession } from "./useShellSession";

/** Where a booking notification opens for each role. */
export function notificationHref(role: AppRole | null, bookingId: string): string | null {
  switch (role) {
    case "customer":
      return paths.customer.tracking(bookingId);
    case "agency":
      return paths.agency.booking(bookingId);
    case "driver":
      return paths.driver.shipment(bookingId);
    default:
      return null;
  }
}

export interface TopBarProps {
  /** Greeting / page title rendered as the page <h1>, e.g. "Hi, Arjun". */
  title?: ReactNode;
  /** Decorative emoji after the title (aria-hidden), e.g. "👋". */
  emoji?: string;
  subtitle?: string;
  /** Only pass when rendered OUTSIDE DashboardShell (the shell has its own < lg menu button). */
  onMenuClick?(): void;
  /** Overrides the unread count from the store. */
  notificationsCount?: number;
  /** Defaults to the signed-in user. */
  user?: { name: string; avatarUrl?: string };
  /** Defaults to the signed-in role's profile page. */
  profileHref?: string;
  /** Defaults to the shared logout (clear session → "/" + toast). */
  onLogout?(): void;
  className?: string;
}

/** Dashboard greeting row: h1 + subtitle on the left; notifications bell and avatar menu on the right. */
export function TopBar({
  title,
  emoji,
  subtitle,
  onMenuClick,
  notificationsCount,
  user,
  profileHref,
  onLogout,
  className,
}: TopBarProps) {
  const { user: sessionUser, role, ready, signedIn } = useShellSession();
  const guest = ready && !signedIn && !user;
  const pathname = usePathname();
  const defaultLogout = useLogout();
  const displayUser = user ?? sessionUser ?? { name: "TAKI user" };
  const profile = profileHref ?? profileFor(role ?? "customer");
  const handleLogout = onLogout ?? defaultLogout;

  return (
    <div className={cn("mb-6 flex items-start gap-3 lg:mb-8", className)}>
      {onMenuClick ? (
        <IconButton label="Open menu" icon={<Menu strokeWidth={1.75} />} onClick={onMenuClick} className="-ml-2 lg:hidden" />
      ) : null}
      <div className="min-w-0 flex-1 pt-1">
        {title ? (
          <h1 className="type-h1 text-ink">
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
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {guest ? (
          <ButtonLink href={loginFor(role ?? "customer", pathname)} variant="outline" size="sm">
            Log in
          </ButtonLink>
        ) : (
          <>
            <NotificationsButton countOverride={notificationsCount} />
            <AccountMenu user={displayUser} profileHref={profile} onLogout={handleLogout} />
          </>
        )}
      </div>
    </div>
  );
}

function NotificationsButton({ countOverride }: { countOverride?: number }) {
  const { items, unreadCount, markAllRead } = useNotifications();
  const { role } = useShellSession();
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
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      />
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        role="region"
        aria-label="Notifications"
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
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">You&apos;re all caught up.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.slice(0, 12).map((n) => {
              const href = n.bookingId ? notificationHref(role, n.bookingId) : null;
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
                      onClick={() => setOpen(false)}
                      className="block px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:-outline-offset-2"
                    >
                      {body}
                    </Link>
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
}: {
  user: { name: string; avatarUrl?: string };
  profileHref: string;
  onLogout(): void;
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
        className="flex h-11 items-center gap-1 rounded-full pl-0.5 pr-1.5 transition-colors hover:bg-ink/6"
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" decorative />
        <ChevronDown aria-hidden="true" strokeWidth={1.75} className="hidden size-4 text-ink-muted sm:block" />
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
