"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { dashboardFor, paths } from "@/lib/config/routes";
import { ButtonLink } from "@/components/ui/Button";
import { MobileNavDrawer, type NavLink } from "./MobileNavDrawer";
import { useShellSession } from "./useShellSession";

/** Login / Dashboard pill (server session, once loaded) + < md hamburger and drawer. */
export function SiteHeaderActions({ links }: { links: NavLink[] }) {
  const { ready, role } = useShellSession();
  const [open, setOpen] = useState(false);
  const cta = ready && role ? { label: "Dashboard", href: dashboardFor(role) } : { label: "Login", href: paths.login() };

  return (
    <div className="flex items-center gap-2">
      <ButtonLink
        href={cta.href}
        variant="outline"
        size="md"
        className="h-11 rounded-md border-transparent bg-white px-4 text-green-950 shadow-card hover:bg-canvas sm:min-w-[104px] sm:px-6"
      >
        {cta.label}
      </ButtonLink>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 md:hidden"
      >
        <Menu aria-hidden="true" strokeWidth={1.75} className="size-6" />
      </button>
      <MobileNavDrawer open={open} onClose={() => setOpen(false)} links={links} cta={cta} />
    </div>
  );
}
