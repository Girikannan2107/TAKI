import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "success" | "info" | "warning" | "danger" | "neutral" | "lavender" | "paid" | "attention";

export interface BadgeProps {
  /** success = Best Price / in transit; info = Top Rated / confirmed; warning = pending / awaiting;
   *  danger = failed / declined; neutral = delivered / cancelled; lavender = More Capacity; paid = Paid (lime);
   *  attention = coral "needs action" (Payment due, Verification pending, pending counts) — always pass an icon. */
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const tones: Record<BadgeTone, string> = {
  success: "bg-success-100 text-success-700",
  info: "bg-info-100 text-info-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-error",
  neutral: "bg-surface-muted text-ink-muted",
  lavender: "bg-violet-100 text-violet-700",
  paid: "bg-lime-100 text-green-800",
  attention: "bg-coral-100 text-coral-700",
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
