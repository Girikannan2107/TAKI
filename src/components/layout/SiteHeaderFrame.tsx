"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

function subscribe(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
}
const getScrolled = () => window.scrollY > 24;
const getServerScrolled = () => false;

/** Client frame for SiteHeader: transparent over the hero, solid forest green after 24px of scroll. */
export function SiteHeaderFrame({ tone, children }: { tone: "overlay" | "solid"; children: ReactNode }) {
  const scrolled = useSyncExternalStore(subscribe, getScrolled, getServerScrolled);
  const solid = tone === "solid" || scrolled;
  return (
    <header
      data-surface="dark"
      className={cn(
        "inset-x-0 top-0 z-40 h-[var(--header-height)] text-white transition-[background-color,box-shadow] duration-200",
        tone === "overlay" ? "fixed" : "sticky",
        solid ? "bg-green-950/95 shadow-[0_8px_24px_-12px] shadow-green-950/60 backdrop-blur" : "bg-transparent",
      )}
    >
      {children}
    </header>
  );
}
