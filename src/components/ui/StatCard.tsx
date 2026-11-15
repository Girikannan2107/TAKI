import Link from "next/link";
import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Small unit after the value, e.g. "kg". */
  unit?: string;
  icon: ReactNode;
  /** When set, the whole card is a link. */
  href?: string;
  trend?: { direction: "up" | "down"; text: string };
  className?: string;
}

/** Dashboard stat tile: icon chip on the left, caption label over the value (compact, left-aligned). */
export function StatCard({ label, value, unit, icon, href, trend, className }: StatCardProps) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-700 [&_svg]:size-5"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-[13px] font-medium leading-[1.15rem] text-ink-muted">{label}</span>
        <span className="type-amount-md flex items-baseline gap-1 text-ink">
          {value}
          {unit ? <span className="text-sm font-semibold text-ink-muted">{unit}</span> : null}
        </span>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-caption font-medium",
              trend.direction === "up" ? "text-green-700" : "text-error",
            )}
          >
            {trend.direction === "up" ? (
              <TrendingUp aria-hidden="true" className="size-3.5" />
            ) : (
              <TrendingDown aria-hidden="true" className="size-3.5" />
            )}
            {trend.text}
          </span>
        ) : null}
      </span>
    </>
  );

  const classes = cn(
    "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          classes,
          "transition-[box-shadow,border-color] duration-200 hover:border-green-300 hover:shadow-raised",
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
