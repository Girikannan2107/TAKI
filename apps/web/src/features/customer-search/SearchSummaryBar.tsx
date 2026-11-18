import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftRight, CalendarDays, MapPin, Package, Search } from "lucide-react";
import type { IsoDate } from "@/lib/domain/model";
import { formatDateShort, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Horizontal search summary (UI reference): From ⇄ To | Shipment date | Load type & weight | Modify search.
 * Read-only fields; the button opens the shipment editor (or the booking when the shipment is locked).
 */
export function SearchSummaryBar({
  from,
  to,
  weightKg,
  date,
  goodsLabel,
  editHref,
  editLabel = "Modify search",
  className,
}: {
  from: string;
  to: string;
  weightKg: number;
  date: IsoDate;
  /** e.g. "General goods" (shown before the weight when known). */
  goodsLabel?: string;
  editHref: string;
  editLabel?: string;
  className?: string;
}) {
  return (
    <section
      aria-label="Your search"
      className={cn(
        "grid grid-cols-2 items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-3 shadow-card sm:p-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.2fr)_auto] lg:gap-x-5 lg:py-3",
        className,
      )}
    >
      <Field icon={<MapPin strokeWidth={1.75} />} label="From" value={from} />
      <ArrowLeftRight aria-hidden="true" strokeWidth={1.75} className="hidden size-5 text-green-700 lg:block" />
      <Field icon={<MapPin strokeWidth={1.75} />} label="To" value={to} />
      <Divider />
      <Field icon={<CalendarDays strokeWidth={1.75} />} label="Shipment date" value={formatDateShort(date)} />
      <Divider />
      <Field icon={<Package strokeWidth={1.75} />} label="Load type & weight" value={goodsLabel ? `${goodsLabel} · ${formatKg(weightKg)}` : formatKg(weightKg)} />
      <Link
        href={editHref}
        className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-green-700 bg-grad-primary px-5 font-heading text-[15px] font-semibold text-white shadow-btn transition-[box-shadow,transform] hover:bg-grad-primary-hover hover:shadow-btn-hover motion-safe:hover:-translate-y-px lg:col-span-1"
      >
        <Search aria-hidden="true" strokeWidth={2} className="size-[18px]" />
        {editLabel}
        <span className="sr-only"> (shipment details)</span>
      </Link>
    </section>
  );
}

function Field({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="flex text-green-700 [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-caption text-ink-muted">{label}</p>
        <p className="truncate font-heading text-[15px] font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="hidden h-10 w-px bg-border lg:block" />;
}
