import { Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface RatingProps {
  /** 0–5, shown with one decimal ("4.8"). */
  value: number;
  /** Number of trips/ratings, shown as "(124 trips)". */
  count?: number;
  /** Noun after the count. Default "trips". */
  countLabel?: string;
  className?: string;
}

/** Filled star + "4.8 (124 trips)". Screen readers hear "Rated 4.8 out of 5 from 124 trips". */
export function Rating({ value, count, countLabel = "trips", className }: RatingProps) {
  const v = value.toFixed(1);
  const sr = `Rated ${v} out of 5${count !== undefined ? ` from ${count} ${countLabel}` : ""}`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm text-ink", className)}>
      <Star aria-hidden="true" strokeWidth={1.5} className="size-4 fill-star text-star" />
      <span aria-hidden="true" className="font-semibold tabular-nums">
        {v}
      </span>
      {count !== undefined ? (
        <span aria-hidden="true" className="text-ink-muted">
          ({count.toLocaleString("en-IN")} {countLabel})
        </span>
      ) : null}
      <span className="sr-only">{sr}</span>
    </span>
  );
}
