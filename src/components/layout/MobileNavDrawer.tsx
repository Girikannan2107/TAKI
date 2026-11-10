"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";

export interface NavLink {
  label: string;
  href: string;
}

export interface MobileNavDrawerProps {
  open: boolean;
  onClose(): void;
  links: NavLink[];
  cta?: { label: string; href: string };
}

/** < md site navigation: right-hand sheet on a native modal dialog (focus trap, Esc, backdrop close, focus return). */
export function MobileNavDrawer({ open, onClose, links, cta }: MobileNavDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} label="Site menu" side="right" surface="dark" className="bg-green-950 bg-grad-sidebar md:hidden">
      <div className="flex items-center justify-between px-4 pt-4">
        <Logo variant="dark" size="sm" href="/" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="inline-flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
        >
          <X aria-hidden="true" strokeWidth={1.75} className="size-6" />
        </button>
      </div>
      <nav aria-label="Site" className="mt-8 flex-1 px-4">
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={onClose}
                className="flex h-12 items-center rounded-md px-3 font-heading text-base font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {cta ? (
        <div className="px-4 pb-6 pt-4">
          <ButtonLink href={cta.href} onClick={onClose} variant="lime" size="lg" fullWidth>
            {cta.label}
          </ButtonLink>
        </div>
      ) : null}
    </Drawer>
  );
}
