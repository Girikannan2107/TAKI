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

/** Driver-dashboard tile: icon in mint disc, caption label, big value. */
export function StatCard({ label, value, unit, icon, href, trend, className }: StatCardProps) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-[22px]"
      >
        {icon}
      </span>
      <span className="mt-1 text-[13px] font-medium leading-tight text-ink-muted">{label}</span>
      <span className="type-amount-md flex items-baseline gap-1 text-ink">
        {value}
        {unit ? <span className="text-base font-semibold">{unit}</span> : null}
      </span>
      {trend ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-caption font-medium",
            trend.direction === "up" ? "text-green-600" : "text-error",
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
    </>
  );

  const classes = cn(
    "flex min-w-0 flex-col items-center gap-1 rounded-lg border border-border bg-surface px-3 py-5 text-center shadow-card",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          classes,
          "transition-[box-shadow,border-color,transform] duration-200 hover:border-border-strong hover:shadow-raised motion-safe:hover:-translate-y-0.5",
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
