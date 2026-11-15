import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "success" | "info" | "warning" | "danger" | "neutral" | "lavender" | "paid" | "attention";

export interface BadgeProps {
  /** success = Best Price / in transit; info = Top Rated / confirmed; warning = pending / awaiting;
   *  danger = failed / declined; neutral = delivered / cancelled; lavender = More Capacity; paid = Paid (lime);
   *  (strict palette: emerald tints for progress, lime for "waiting/needs action", red only for failures)
   *  attention = lime "needs action" (Payment due, Verification pending, pending counts) — always pass an icon. */
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const tones: Record<BadgeTone, string> = {
  success: "bg-green-100 text-green-800",
  info: "bg-surface text-green-800 ring-1 ring-inset ring-green-300",
  warning: "bg-lime-100 text-green-950 ring-1 ring-inset ring-lime-400/70",
  danger: "bg-danger-100 text-error",
  neutral: "bg-surface-muted text-ink-muted",
  lavender: "bg-surface text-green-800 ring-1 ring-inset ring-green-300",
  paid: "bg-lime-300 text-green-950",
  attention: "bg-lime-300 text-green-950",
};

export function Badge({ tone = "neutral", size = "sm", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "sm" ? "h-6 px-2.5 text-caption" : "h-7 px-3 text-[13px]",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        tones[tone],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
