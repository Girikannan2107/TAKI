"use client";

import Link from "next/link";
import { LogOut, X } from "lucide-react";
import { isNavItemActive, type NavItem } from "@/lib/config/nav";
import { cn } from "@/lib/utils/cn";
import { Logo } from "@/components/brand/Logo";

export interface DashboardSidebarProps {
  nav: NavItem[];
  /** Current pathname; active item is resolved with isNavItemActive(). */
  activeHref: string;
  /** Called after a nav link is followed (closes the drawer). In the drawer variant it also backs the close (X) button. */
  onNavigate?(): void;
  onLogout(): void;
  variant?: "fixed" | "drawer";
  /** Logo link target (role dashboard). */
  homeHref?: string;
}

/** Dark forest-green panel: Logo, nav with pale-lime active pill (aria-current="page"), Log out at the bottom. */
export function DashboardSidebar({
  nav,
  activeHref,
  onNavigate,
  onLogout,
  variant = "fixed",
  homeHref = "/",
}: DashboardSidebarProps) {
  return (
    <div data-surface="dark" className="flex h-full min-h-0 flex-col bg-green-900 bg-grad-sidebar px-4 pb-5 pt-6 text-white">
      <div className="flex items-center justify-between gap-2 pl-2">
        <Logo variant="dark" size="md" href={homeHref} />
        {variant === "drawer" && onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close menu"
            className="inline-flex size-11 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" strokeWidth={1.75} className="size-5" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className="mt-10 flex-1">
        <ul className="flex flex-col gap-1.5">
          {nav.map((item) => {
            const active = isNavItemActive(item, activeHref);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md px-3 font-heading text-[15px] font-semibold transition-colors duration-150",
                    active
                      ? "bg-lime-300 text-green-950 shadow-[0_4px_14px_-6px] shadow-lime-300/60"
                      : "text-white/85 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 border-t border-white/12 pt-4">
        <button
          type="button"
          onClick={onLogout}
          className="flex h-11 w-full items-center gap-3 rounded-md px-3 font-heading text-[15px] font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0" />
          Log out
        </button>
      </div>
    </div>
  );
}
