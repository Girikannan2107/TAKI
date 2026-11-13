import Link from "next/link";
import { CalendarDays, Package, Pencil } from "lucide-react";
import type { IsoDate } from "@/lib/domain/model";
import { formatDate, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { RouteText } from "./RouteText";

/** "Coimbatore → Chennai | 500 kg | 20 Nov, 2026" + Edit link. */
export function SearchSummaryBar({
  from,
  to,
  weightKg,
  date,
  editHref,
  editLabel = "Edit",
  className,
}: {
  from: string;
  to: string;
  weightKg: number;
  date: IsoDate;
  editHref: string;
  editLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-x-3 rounded-lg border border-border bg-surface px-4 py-2 shadow-card sm:pl-5", className)}>
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm font-medium text-ink sm:text-base">
        <span className="sr-only">Your search: </span>
        <RouteText from={from} to={to} className="font-semibold" />
        <Divider />
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Package aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-600" />
          {formatKg(weightKg)}
        </span>
        <Divider />
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <CalendarDays aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-600" />
          {formatDate(date)}
        </span>
      </p>
      <Link
        href={editHref}
        className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-green-700 hover:bg-surface-muted hover:text-green-800"
      >
        <Pencil aria-hidden="true" strokeWidth={1.75} className="size-4" />
        {editLabel}
        <span className="sr-only"> shipment</span>
      </Link>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="hidden h-4 w-px bg-border-strong sm:block" />;
}
