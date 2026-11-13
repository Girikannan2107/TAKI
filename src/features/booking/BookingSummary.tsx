import type { ReactNode } from "react";
import type { PricingBreakdownV2 } from "@/lib/domain/model";
import { formatINR, formatKg, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export interface BookingSummaryProps {
  pricing: PricingBreakdownV2;
  /** Section heading (h2). Default "Booking Summary". */
  title?: string;
  className?: string;
  footnote?: ReactNode;
}

/**
 * Price breakdown (vehicle details, payment, receipt): distance charge (km × rate), weight
 * charge (kg × rate), handling fee, TAKI service fee, bold Total Payable. Server-safe; all
 * values come from the server's pricing snapshot.
 */
export function BookingSummary({
  pricing,
  title = "Booking Summary",
  className,
  footnote,
}: BookingSummaryProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-lg border border-border bg-surface p-5 shadow-card sm:p-6",
        className,
      )}
    >
      <h2 className="type-h3 text-ink">{title}</h2>
      <dl className="mt-4 space-y-3 text-sm sm:text-base">
        <Line
          term={`Distance charge`}
          detail={`${pricing.distanceKm.toLocaleString("en-IN")} km × ${formatRate(pricing.ratePerKmPaise)}/km`}
          value={pricing.distanceCharge}
        />
        <Line term="Weight charge" detail={`${formatKg(pricing.weightKg)} × ${formatRate(pricing.ratePerKgPaise)}/kg`} value={pricing.weightCharge} />
        {pricing.handlingFee > 0 ? <Line term="Special handling fee" value={pricing.handlingFee} /> : null}
        <Line term="TAKI service fee" value={pricing.serviceFee} />
        {/* dt/dd must be direct children of a single div inside <dl> (axe dlitem/definition-list). */}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <dt className="font-heading text-base font-bold text-ink sm:text-lg">
            Total Payable
          </dt>
          <dd data-testid="price-total" className="type-amount-lg text-price">
            {formatINR(pricing.totalPayable)}
          </dd>
        </div>
      </dl>
      {footnote ? (
        <div className="mt-3 text-caption text-ink-subtle">{footnote}</div>
      ) : null}
    </section>
  );
}

function Line({ term, detail, value }: { term: string; detail?: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">
        {term}
        {detail ? <span className="block text-caption text-ink-subtle tabular-nums">{detail}</span> : null}
      </dt>
      <dd className="font-medium tabular-nums text-ink">{formatINR(value)}</dd>
    </div>
  );
}
