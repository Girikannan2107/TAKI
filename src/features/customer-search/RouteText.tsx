import { ArrowRight } from "lucide-react";
import { cityName } from "@/lib/domain/cities";
import type { CityId } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

/** "Coimbatore → Chennai" with the arrow hidden from screen readers (read as "to"). */
export function RouteText({ from, to, className, arrowClassName }: { from: CityId; to: CityId; className?: string; arrowClassName?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5", className)}>
      <span>{cityName(from)}</span>
      <ArrowRight aria-hidden="true" strokeWidth={2} className={cn("size-4 shrink-0 text-green-600", arrowClassName)} />
      <span className="sr-only">to</span>
      <span>{cityName(to)}</span>
    </span>
  );
}
