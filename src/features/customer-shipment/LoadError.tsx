"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/api/http";
import { cn } from "@/lib/utils/cn";

/** P3 §3.0 load-error state: plain message + "Try again". */
export function LoadError({
  error,
  title = "We couldn't load this",
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card as="section" role="alert" padding="md" className={cn("flex flex-col items-start gap-3 sm:flex-row sm:items-center", className)}>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-error [&_svg]:size-5">
        <CircleAlert strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sm text-error">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} leadingIcon={<RotateCcw aria-hidden="true" strokeWidth={1.75} />}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}
