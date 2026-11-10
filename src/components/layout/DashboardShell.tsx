"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { customerNav, driverNav, type NavItem } from "@/lib/config/nav";
import type { Role } from "@/lib/domain/types";
import { dashboardFor } from "@/lib/config/routes";
import { Logo } from "@/components/brand/Logo";
import { Drawer } from "@/components/ui/Drawer";
import { DashboardSidebar } from "./DashboardSidebar";
import { useLogout } from "./useLogout";

export interface DashboardShellProps {
  role: Role;
  /** Defaults to customerNav / driverNav for the role. Only pass from client components —
   *  nav items hold icon components, which cannot cross the server → client boundary. */
  nav?: NavItem[];
  children: ReactNode;
}

/**
 * ≥ lg: fixed 240px sidebar + content. < lg: slim dark top bar (menu + logo) and the sidebar as a drawer.
 * Pages render their own TopBar (dashboards) or PageHeader (flows) inside <main id="main">.
 */
export function DashboardShell({ role, nav: navProp, children }: DashboardShellProps) {
  const nav = navProp ?? (role === "driver" ? driverNav : customerNav);
  const pathname = usePathname();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const home = dashboardFor(role);

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
    <div className="min-h-dvh bg-canvas lg:pl-60">
      <aside aria-label="Sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <DashboardSidebar nav={nav} activeHref={pathname} onLogout={logout} homeHref={home} />
      </aside>

      <header
        data-surface="dark"
        className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-green-950 px-2 text-white shadow-[0_1px_0] shadow-white/10 sm:px-4 lg:hidden"
      >
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
        <Logo variant="dark" size="sm" href={home} />
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu" side="left" surface="dark" className="lg:hidden">
        <DashboardSidebar
          nav={nav}
          activeHref={pathname}
          variant="drawer"
          homeHref={home}
          onNavigate={() => setDrawerOpen(false)}
          onLogout={() => {
            setDrawerOpen(false);
            logout();
          }}
        />
      </Drawer>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1184px] px-4 pb-16 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
