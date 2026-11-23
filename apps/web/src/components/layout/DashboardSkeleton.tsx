import { Skeleton } from "@/components/ui/Skeleton";

/** Content-area placeholder shown while the session store hydrates (inside DashboardShell's <main>). */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span role="status" className="sr-only">
        Loading your dashboard…
      </span>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-xs flex-1 flex-col gap-3">
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex shrink-0 gap-2">
          <Skeleton rounded="full" className="size-11" />
          <Skeleton rounded="full" className="size-11" />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card lg:p-6">
        <Skeleton className="mb-5 h-5 w-40" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="h-13" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
