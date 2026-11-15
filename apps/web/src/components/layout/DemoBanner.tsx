import type { ReactNode } from "react";
import { FlaskConical, Info } from "lucide-react";
import { isDemo } from "@/lib/config/env";
import { cn } from "@/lib/utils/cn";

export interface DemoBannerProps {
  kind: "otp" | "payment" | "payout" | "map" | "general";
  /** Defaults per kind (see below). */
  title?: string;
  children?: ReactNode;
  /** Single-line, smaller variant (e.g. under a button). */
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}

const defaultTitles: Record<DemoBannerProps["kind"], string> = {
  otp: "Demo mode — no SMS is sent",
  payment: "Demo payment — no money moves",
  payout: "Demo payout — no money moves",
  map: "Illustrative route — not live location",
  general: "Demo mode",
};

/**
 * Honest notice for simulated features. Never implies a real SMS, payment, payout or GPS fix.
 * Hidden in live mode, except kind="map" (the route illustration is never live tracking).
 */
export function DemoBanner({ kind, title, children, compact = false, className, "data-testid": testId }: DemoBannerProps) {
  if (!isDemo && kind !== "map") return null;
  const Icon = kind === "map" ? Info : FlaskConical;
  const heading = title ?? defaultTitles[kind];

  if (compact) {
    return (
      <p
        role="note"
        data-testid={testId}
        className={cn(
          "flex items-start gap-1.5 rounded-sm bg-warning-100 px-2.5 py-1.5 text-[13px] leading-5 text-warning-700",
          className,
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">{heading}</strong>
          {children ? <> · {children}</> : null}
        </span>
      </p>
    );
  }

  return (
    <div
      role="note"
      data-testid={testId}
      className={cn(
        "flex items-start gap-3 rounded-md border border-warning-700/15 bg-warning-100 px-4 py-3 text-sm text-warning-700",
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{heading}</p>
        {children ? <div className="mt-0.5 leading-5 text-warning-700/95">{children}</div> : null}
      </div>
    </div>
  );
}
