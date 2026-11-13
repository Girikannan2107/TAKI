"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { navFor, type NavItem } from "@/lib/config/nav";
import { dashboardFor, loginFor, type AppRole } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { Logo } from "@/components/brand/Logo";
import { Drawer } from "@/components/ui/Drawer";
import { BottomNav } from "./BottomNav";
import { DashboardSidebar } from "./DashboardSidebar";
import { useLogout } from "./useLogout";
import { useShellSession } from "./useShellSession";

/** Driver action screens use a sticky action bar instead of the bottom tabs. */
export const DRIVER_ACTION_PATHS: readonly string[] = ["/driver/shipments/", "/driver/trips/"];

export interface DashboardShellProps {
  role: AppRole;
  /** Defaults to navFor(role). Only pass from client components —
   *  nav items hold icon components, which cannot cross the server → client boundary. */
  nav?: NavItem[];
  /** < lg navigation: "drawer" (hamburger + side drawer; customer/agency/admin) or "bottom" (fixed tab bar; driver app).
   *  Defaults to "bottom" for the driver role, otherwise "drawer". */
  mobileNav?: "drawer" | "bottom";
  /** Path prefixes where the bottom bar is hidden. A trailing "/" matches sub-paths only.
   *  Default for drivers: DRIVER_ACTION_PATHS. */
  hideBottomNavOn?: readonly string[];
  children: ReactNode;
}

function pathMatches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? pathname.startsWith(p) && pathname.length > p.length : pathname === p || pathname.startsWith(p + "/")));
}

/**
 * ≥ lg: fixed 240px sidebar + content. < lg: slim dark-sage top bar and either a drawer (menu button) or a fixed
 * bottom tab bar. Pages render their own TopBar (dashboards) or PageHeader (flows) inside <main id="main">.
 */
export function DashboardShell({ role, nav: navProp, mobileNav: mobileNavProp, hideBottomNavOn, children }: DashboardShellProps) {
  const nav = navProp ?? navFor(role);
  const mobileNav = mobileNavProp ?? (role === "driver" ? "bottom" : "drawer");
  const pathname = usePathname();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const home = dashboardFor(role);
  // Guests may browse the public search pages inside the customer shell.
  const { ready, signedIn } = useShellSession();
  const loginHref = ready && !signedIn ? loginFor(role, pathname) : undefined;
  const hidePaths = hideBottomNavOn ?? (role === "driver" ? DRIVER_ACTION_PATHS : []);
  const showBottomNav = mobileNav === "bottom" && !pathMatches(pathname, hidePaths);

  // Close the drawer if the viewport grows to the fixed-sidebar breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="min-h-dvh bg-canvas lg:pl-60" data-role={role}>
      <aside aria-label="Sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <DashboardSidebar nav={nav} activeHref={pathname} onLogout={logout} homeHref={home} loginHref={loginHref} />
      </aside>

      <header
        data-surface="dark"
        className={cn(
          "sticky top-0 z-30 flex h-14 items-center gap-2 bg-sage-900 px-2 text-white shadow-[0_1px_0] shadow-white/10 sm:px-4 lg:hidden",
          mobileNav === "bottom" && "px-4",
        )}
      >
        {mobileNav === "drawer" ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            className="inline-flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
          >
            <Menu aria-hidden="true" strokeWidth={1.75} className="size-6" />
          </button>
        ) : null}
        <Logo variant="dark" size="sm" href={home} />
      </header>

      {mobileNav === "drawer" ? (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu" side="left" surface="dark" className="lg:hidden">
          <DashboardSidebar
            nav={nav}
            activeHref={pathname}
            variant="drawer"
            homeHref={home}
            loginHref={loginHref}
            onNavigate={() => setDrawerOpen(false)}
            onLogout={() => {
              setDrawerOpen(false);
              logout();
            }}
          />
        </Drawer>
      ) : null}

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "mx-auto w-full max-w-[1184px] px-4 pb-16 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-8",
          showBottomNav && "pb-28 lg:pb-16",
        )}
      >
        {children}
      </main>

      {showBottomNav ? <BottomNav nav={nav} activeHref={pathname} /> : null}
    </div>
  );
}
