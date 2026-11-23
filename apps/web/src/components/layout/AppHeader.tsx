"use client";

import Link from "next/link";
import { useId } from "react";
import { ChevronDown, Menu } from "lucide-react";
import { isNavItemActive, type NavItem } from "@/lib/config/nav";
import { cn } from "@/lib/utils/cn";
import { Logo } from "@/components/brand/Logo";
import { usePopover } from "./usePopover";
import { useShellSession } from "./useShellSession";
import { GuestActions, SignedInActions } from "./TopBar";

export interface AppHeaderProps {
  nav: NavItem[];
  pathname: string;
  homeHref: string;
  /** Show the hamburger (opens the shell's drawer) below the top-nav breakpoint. */
  onOpenMenu?(): void;
  menuOpen?: boolean;
}

const pill =
  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 font-heading text-[15px] font-semibold transition-colors";
const pillIdle = "text-white/90 hover:bg-white/10 hover:text-white";
const pillActive = "bg-lime-300 text-green-950 shadow-[0_4px_14px_-6px] shadow-lime-300/60";

/**
 * Horizontal TAKI top navigation (UI reference): dark primary bar with the logo, role nav as pills
 * (active = light-green pill), notifications and the account menu. Long navs (agency) collapse to the
 * drawer below xl; items with placement "more" go into a "More" menu and "account" items only appear
 * in the account menu.
 */
export function AppHeader({ nav, pathname, homeHref, onOpenMenu, menuOpen }: AppHeaderProps) {
  const { ready, signedIn } = useShellSession();
  const top = nav.filter((i) => !i.placement);
  const more = nav.filter((i) => i.placement === "more");
  const wide = top.length > 4; // long navs (agency): switch to the top nav only from xl
  const hasDrawer = Boolean(onOpenMenu);

  return (
    <header data-surface="dark" className="sticky top-0 z-30 bg-sage-900 text-white shadow-[0_1px_0] shadow-white/10">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-2 px-3 sm:px-6 lg:h-[72px] lg:gap-4 lg:px-8">
        {hasDrawer ? (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className={cn(
              "-ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10",
              wide ? "xl:hidden" : "lg:hidden",
            )}
          >
            <Menu aria-hidden="true" strokeWidth={1.75} className="size-6" />
          </button>
        ) : null}

        <Logo variant="dark" size="md" href={homeHref} className="shrink-0" />

        <nav aria-label="Main" className={cn("ml-2 min-w-0 flex-1 items-center gap-1 xl:ml-6", wide ? "hidden xl:flex" : "hidden lg:flex")}>
          <ul className="flex items-center gap-1">
            {top.map((item) => {
              const active = isNavItemActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={active ? "page" : undefined} className={cn(pill, active ? pillActive : pillIdle)}>
                    <Icon aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {more.length > 0 ? (
              <li>
                <MoreMenu items={more} pathname={pathname} />
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="ml-auto flex shrink-0 items-center">
          {!ready ? <span className="h-11 w-24" aria-hidden="true" /> : signedIn ? <SignedInActions tone="dark" /> : <GuestActions tone="dark" />}
        </div>
      </div>
    </header>
  );
}

function MoreMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { open, setOpen, triggerRef, panelRef } = usePopover<HTMLButtonElement>();
  const id = useId();
  const anyActive = items.some((i) => isNavItemActive(i, pathname));
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={cn(pill, anyActive ? pillActive : pillIdle)}
      >
        More
        <ChevronDown aria-hidden="true" strokeWidth={1.75} className="size-4" />
      </button>
      <div
        ref={panelRef}
        id={id}
        hidden={!open}
        className="absolute left-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 text-ink shadow-raised motion-safe:animate-pop-in"
      >
        <ul>
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex h-11 items-center gap-3 px-4 text-[15px] font-medium transition-colors hover:bg-surface-muted",
                  active && "bg-green-50 font-semibold text-green-800",
                )}
              >
                <Icon aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-700" />
                {item.label}
              </Link>
            </li>
          );
        })}
        </ul>
      </div>
    </div>
  );
}
