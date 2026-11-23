"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { navFor, type NavItem } from "@/lib/config/nav";
import { dashboardFor, loginFor, type AppRole } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { Drawer } from "@/components/ui/Drawer";
import { AppHeader } from "./AppHeader";
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
 * Horizontal TAKI top navigation (AppHeader) for every role. Below the top-nav breakpoint the nav moves to a
 * drawer (menu button) or, for the driver app, a fixed bottom tab bar. Pages render their own TopBar
 * (dashboards) or PageHeader (flows) inside <main id="main">.
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
  // Long navs (agency) only fit as top-bar pills from xl (80rem); the rest from lg (64rem).
  const wide = nav.filter((i) => !i.placement).length > 4;

  // Close the drawer if the viewport grows to the top-nav breakpoint.
  useEffect(() => {
    const mq = window.matchMedia(wide ? "(min-width: 80rem)" : "(min-width: 64rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [wide]);

  return (
    <div className="min-h-dvh bg-canvas" data-role={role}>
      <AppHeader
        nav={nav}
        pathname={pathname}
        homeHref={home}
        onOpenMenu={mobileNav === "drawer" ? () => setDrawerOpen(true) : undefined}
        menuOpen={drawerOpen}
      />

      {mobileNav === "drawer" ? (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu" side="left" surface="dark" className={wide ? "xl:hidden" : "lg:hidden"}>
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
          "mx-auto w-full max-w-[1280px] px-4 pb-16 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-8",
          showBottomNav && "pb-28 lg:pb-16",
        )}
      >
        {children}
      </main>

      {showBottomNav ? <BottomNav nav={nav} activeHref={pathname} /> : null}
    </div>
  );
}
