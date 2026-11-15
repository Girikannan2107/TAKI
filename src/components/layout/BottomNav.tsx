"use client";

import Link from "next/link";
import { isNavItemActive, type NavItem } from "@/lib/config/nav";
import { cn } from "@/lib/utils/cn";

export interface BottomNavProps {
  nav: NavItem[];
  /** Current pathname; the active tab is resolved with isNavItemActive(). */
  activeHref: string;
  className?: string;
}

/**
 * Driver app < lg: fixed bottom tab bar (dark sage, 64px + safe area). Active tab = lime icon + label + top indicator.
 * Labelled nav "Main" so it is the only main navigation landmark visible on phones.
 */
export function BottomNav({ nav, activeHref, className }: BottomNavProps) {
  return (
    <nav
      aria-label="Main"
      data-surface="dark"
      className={cn("fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-sage-900 pb-safe text-white lg:hidden", className)}
    >
      <ul className="mx-auto grid h-16 max-w-xl" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map((item) => {
          const active = isNavItemActive(item, activeHref);
          const Icon = item.icon;
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold leading-tight transition-colors focus-visible:-outline-offset-4",
                  active ? "text-lime-300" : "text-white/80 hover:text-white",
                )}
              >
                {active ? <span aria-hidden="true" className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-lime-300" /> : null}
                <Icon aria-hidden="true" strokeWidth={active ? 2 : 1.75} className="size-6 shrink-0" />
                <span className="line-clamp-2 max-w-full text-center">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
