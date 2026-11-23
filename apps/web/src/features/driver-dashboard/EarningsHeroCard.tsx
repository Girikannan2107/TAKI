import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MiniAreaChart } from "@/components/ui";
import { formatChangePct, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export interface EarningsHeroCardProps {
  amount: number;
  /** Change vs last month in %, null when there were no earnings last month (trend hidden). */
  changePct: number | null;
  /** Monthly totals, oldest first (sparkline). */
  series: number[];
  href: string;
  className?: string;
}

/** Dark-green "Total Earnings (This Month)" card; the whole card links to Earnings. */
export function EarningsHeroCard({ amount, changePct, series, href, className }: EarningsHeroCardProps) {
  const up = changePct !== null && changePct >= 0;
  return (
    <Link
      href={href}
      data-surface="dark"
      data-testid="earnings-hero"
      className={cn(
        "group relative grid min-w-0 grid-cols-1 items-end gap-4 overflow-hidden rounded-lg bg-green-700 bg-grad-earnings p-5 text-white shadow-raised sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-6 lg:p-7",
        "transition-[box-shadow,transform] duration-200 hover:shadow-raised motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-base font-medium text-white/90">Revenue (This Month)</p>
        <p className="type-amount-xl mt-1.5 text-white" data-testid="earnings-amount">
          {formatINR(amount)}
        </p>
        {changePct !== null ? (
          <p className={cn("mt-1.5 flex items-center gap-1.5 text-sm font-medium", up ? "text-lime-300" : "text-white")}>
            <span aria-hidden="true" className="text-[11px]">
              {up ? "▲" : "▼"}
            </span>
            <span data-testid="earnings-trend">{formatChangePct(changePct)}</span>
          </p>
        ) : null}
        <span className="mt-4 flex w-fit items-center gap-1 text-sm font-semibold text-white/90 underline-offset-4 group-hover:underline">
          View earnings
          <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
        </span>
      </div>
      {series.length > 1 ? (
        <div aria-hidden="true" className="pointer-events-none -mb-2 min-w-0 sm:-mr-2 sm:self-end">
          <MiniAreaChart data={series} tone="onDark" width={320} height={96} ariaLabel="" className="max-h-20 sm:max-h-28" />
        </div>
      ) : null}
    </Link>
  );
}
