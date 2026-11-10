"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useDialog } from "./useDialog";

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  /** Accessible name of the drawer (aria-label). */
  label: string;
  side?: "left" | "right";
  /** Sets data-surface="dark" so focus rings switch to lime. */
  surface?: "light" | "dark";
  className?: string;
  children: ReactNode;
}

/** Off-canvas sheet on a native modal <dialog>: focus-trapped, Esc / backdrop close, returns focus. */
export function Drawer({ open, onClose, label, side = "left", surface = "light", className, children }: DrawerProps) {
  const dialogProps = useDialog(open, onClose);
  return (
    <dialog
      {...dialogProps}
      aria-label={label}
      data-surface={surface === "dark" ? "dark" : undefined}
      className={cn(
        "fixed inset-y-0 m-0 h-dvh max-h-none w-[min(18rem,85vw)] max-w-none overflow-hidden",
        side === "left" ? "left-0 right-auto open:motion-safe:animate-drawer-left" : "left-auto right-0 open:motion-safe:animate-drawer-right",
        "backdrop:motion-safe:animate-fade-in",
        surface === "dark" ? "bg-green-950 text-white" : "bg-surface text-ink",
        className,
      )}
    >
      {open ? <div className="flex h-full flex-col overflow-y-auto">{children}</div> : null}
    </dialog>
  );
}
