import type { ReactNode } from "react";
import type { PricingBreakdownV2, PricingLine } from "@/lib/domain/model";
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
 * Price breakdown (vehicle details, payment, receipt). Renders the server's `pricing.lines` in order
 * (distance, weight, each additional charge, TAKI service fee; Σ = total) with the km / kg working under
 * the first two, then the bold Total Payable. Server-safe; every value comes from the pricing snapshot.
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
        {linesOf(pricing).map((l, i) => (
          <Line key={`${l.code}-${i}`} term={l.label} detail={detailFor(l.code, pricing)} value={l.amount} />
        ))}
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

/** The server's lines; older snapshots without lines are rebuilt from the totals. */
export function linesOf(p: PricingBreakdownV2): PricingLine[] {
  if (p.lines?.length) return p.lines;
  const extra = p.additionalCharges ?? p.handlingFee;
  return [
    { code: "distance", label: "Distance charge", amount: p.distanceCharge },
    { code: "weight", label: "Weight charge", amount: p.weightCharge },
    ...(extra > 0 ? [{ code: "additional" as const, label: "Additional charges", amount: extra }] : []),
    { code: "service_fee", label: "TAKI service fee", amount: p.serviceFee },
  ];
}

function detailFor(code: PricingLine["code"], p: PricingBreakdownV2): string | undefined {
  if (code === "distance") return `${p.distanceKm.toLocaleString("en-IN")} km × ${formatRate(p.ratePerKmPaise)}/km`;
  if (code === "weight") return `${formatKg(p.weightKg)} × ${formatRate(p.ratePerKgPaise)}/kg`;
  return undefined;
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
