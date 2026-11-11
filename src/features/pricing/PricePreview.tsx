import { previewQuote } from "@/lib/domain/commands";
import type { Paise } from "@/lib/domain/types";
import { formatINR, formatKg, formatKm, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export interface PricePreviewProps {
  distanceKm: number;
  weightKg: number;
  /** null when the field is currently invalid → the line shows "—". */
  ratePerKmPaise: Paise | null;
  ratePerKgPaise: Paise | null;
  className?: string;
}

const DASH = "—";

/** "Price Preview (example)" for the Set Pricing screen. All amounts come from previewQuote(). */
export function PricePreview({ distanceKm, weightKg, ratePerKmPaise, ratePerKgPaise, className }: PricePreviewProps) {
  const valid = ratePerKmPaise !== null && ratePerKgPaise !== null;
  const q = valid ? previewQuote(distanceKm, ratePerKmPaise, ratePerKgPaise, weightKg) : null;
  const kmRate = ratePerKmPaise !== null ? formatRate(ratePerKmPaise) : DASH;
  const kgRate = ratePerKgPaise !== null ? formatRate(ratePerKgPaise) : DASH;

  return (
    <section
      aria-labelledby="price-preview-title"
      data-testid="price-preview"
      className={cn("overflow-hidden rounded-lg border border-green-200 bg-green-50", className)}
    >
      <div className="px-5 pb-3 pt-5">
        <h2 id="price-preview-title" className="type-h3 text-ink">
          Price Preview (example)
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          For {formatKg(weightKg)} (≈ {formatKm(distanceKm)})
        </p>
      </div>
      <dl aria-live="polite" aria-atomic="true" className="text-[15px]">
        <div className="flex items-baseline justify-between gap-4 border-t border-green-200/70 px-5 py-2.5">
          <dt className="min-w-0 text-ink-muted">
            Distance charge ({formatKm(distanceKm)} × {kmRate})
          </dt>
          <dd className="shrink-0 font-semibold tabular-nums text-ink" data-testid="preview-distance">
            {q ? formatINR(q.distanceCharge) : DASH}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-5 pb-3 pt-1">
          <dt className="min-w-0 text-ink-muted">
            Weight charge ({formatKg(weightKg)} × {kgRate})
          </dt>
          <dd className="shrink-0 font-semibold tabular-nums text-ink" data-testid="preview-weight">
            {q ? formatINR(q.weightCharge) : DASH}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-green-200 bg-mint-100 px-5 py-3.5">
          <dt className="min-w-0 font-heading font-bold text-green-900">Your Earnings (before TAKI fee)</dt>
          <dd className="type-amount-md shrink-0 text-green-900" data-testid="preview-earnings">
            {q ? formatINR(q.transportationCharge) : DASH}
          </dd>
        </div>
      </dl>
    </section>
  );
}
