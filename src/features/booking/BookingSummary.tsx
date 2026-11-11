import type { ReactNode } from "react";
import type { PricingBreakdown } from "@/lib/domain/types";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export interface BookingSummaryProps {
  pricing: PricingBreakdown;
  /** Section heading (h2). Default "Booking Summary". */
  title?: string;
  className?: string;
  footnote?: ReactNode;
}

/**
 * Price breakdown card body (screen 08/09): Transportation Charge, TAKI Service Fee,
 * divider, bold Total Payable. Server-safe; all values come from the pricing snapshot.
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
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">Transportation Charge</dt>
          <dd className="font-medium tabular-nums text-ink">
            {formatINR(pricing.transportationCharge)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">TAKI Service Fee</dt>
          <dd className="font-medium tabular-nums text-ink">
            {formatINR(pricing.serviceFee)}
          </dd>
        </div>
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
