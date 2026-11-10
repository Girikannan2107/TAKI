import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { iconButtonClasses } from "@/components/ui/IconButton";

export interface PageHeaderProps {
  title: string;
  /** Rendered as " (3)" after the title. */
  count?: number;
  /** Back arrow link (preferred — real navigation). */
  backHref?: string;
  /** Back arrow button (client components only; used when no backHref). */
  onBack?(): void;
  /** Accessible name of the back control. Default "Back". */
  backLabel?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Inner-page header: back arrow + h1 (visual h2 size) + optional count, subtitle and actions. */
export function PageHeader({
  title,
  count,
  backHref,
  onBack,
  backLabel = "Back",
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  const backClasses = iconButtonClasses({ className: "-ml-2.5 text-ink" });
  const back = backHref ? (
    <Link href={backHref} aria-label={backLabel} className={backClasses}>
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
    </Link>
  ) : onBack ? (
    <button type="button" onClick={onBack} aria-label={backLabel} className={backClasses}>
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
    </button>
  ) : null;

  return (
    <div className={cn("mb-6 flex flex-wrap items-start gap-x-3 gap-y-3 lg:mb-8", className)}>
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        {back}
        <div className={cn("min-w-0", back && "pt-1.5")}>
          <h1 className="type-h2 text-ink">
            {title}
            {count !== undefined ? <span className="tabular-nums"> ({count})</span> : null}
          </h1>
          {subtitle ? <div className="mt-1 text-sm text-ink-muted sm:text-base">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
