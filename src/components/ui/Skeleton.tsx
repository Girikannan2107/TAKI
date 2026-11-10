import { cn } from "@/lib/utils/cn";

export interface SkeletonProps {
  className?: string;
  /** Render N stacked text lines (the last one shorter). */
  lines?: number;
  rounded?: "sm" | "md" | "full";
}

const radius = { sm: "rounded-sm", md: "rounded-md", full: "rounded-full" } as const;
const base = "block bg-skeleton-shimmer motion-safe:animate-shimmer";

/**
 * Decorative loading placeholder (aria-hidden). Wrap a group in an element with
 * `aria-busy="true"` and a `<span className="sr-only">Loading…</span>`.
 */
export function Skeleton({ className, lines, rounded = "md" }: SkeletonProps) {
  if (lines && lines > 0) {
    return (
      <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={cn(base, radius[rounded], "h-3.5", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")}
          />
        ))}
      </span>
    );
  }
  return <span aria-hidden="true" className={cn(base, radius[rounded], "h-4 w-full", className)} />;
}
