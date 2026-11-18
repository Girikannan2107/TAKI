"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Clock3, FileWarning } from "lucide-react";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import type { AdminVerificationDTO } from "@/lib/api/contracts/admin";
import { errorMessage } from "@/lib/api/http";

/** Status badge for a review item: Ready for review / Waiting for documents / Verified / Rejected. */
export function ReviewBadge({ verification, complete }: { verification: AdminVerificationDTO; complete: boolean }) {
  if (verification.status === "verified")
    return (
      <Badge tone="success" icon={<CircleCheck aria-hidden="true" className="size-3.5" />}>
        Verified
      </Badge>
    );
  if (verification.status === "rejected")
    return (
      <Badge tone="danger" icon={<CircleAlert aria-hidden="true" className="size-3.5" />}>
        Rejected
      </Badge>
    );
  if (verification.submittedAt && complete)
    return (
      <Badge tone="attention" icon={<Clock3 aria-hidden="true" className="size-3.5" />}>
        Ready for review
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={<FileWarning aria-hidden="true" className="size-3.5" />}>
      Waiting for documents
    </Badge>
  );
}

export type Loadable<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/**
 * Fetch-on-mount with retry. `key` re-runs the load (e.g. a tab value). `reload()` keeps showing the current
 * data while it refreshes (use after a mutation).
 */
export function useLoad<T>(load: () => Promise<T>, key: string): { state: Loadable<T>; reload(): void; set(data: T): void } {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    // Key changed (tab switch): show the loading state for the new list.
    setPrevKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
    // `load` is recreated each render by callers; `key` + `attempt` decide when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const reload = useCallback(() => {
    setState((s) => (s.status === "error" ? { status: "loading" } : s));
    setAttempt((n) => n + 1);
  }, []);
  const set = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { state, reload, set };
}

export function ListSkeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" rounded="md" />
      ))}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return <EmptyState icon={<CircleAlert className="size-6" />} title="Something went wrong" description={message} action={{ label: "Try again", onClick: onRetry }} />;
}
