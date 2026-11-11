import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui";

/** Placeholder for an auth card body while the URL / stored flow state loads. */
export function AuthSkeleton({ fields = 1, label = "Loading" }: { fields?: number; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">{label}…</span>
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
      <Skeleton className="h-13 w-full" />
    </div>
  );
}

/**
 * Inline service error for a form (e.g. "Mobile number or password is incorrect.").
 * Always mounted so screen readers announce changes; renders nothing visible when empty.
 */
export function FormAlert({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  return (
    <div id={id} role="alert" aria-atomic="true" className={children ? className : "absolute"}>
      {children ? (
        <div className="flex items-start gap-2 rounded-md border border-error/20 bg-danger-100 px-3.5 py-3 text-sm font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Underlined inline text link used inside auth cards. */
export const authLinkClasses =
  "inline-flex min-h-11 items-center font-semibold text-green-700 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700";
