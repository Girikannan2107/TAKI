import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { iconButtonClasses } from "@/components/ui/IconButton";

export interface AuthCardHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Renders a back arrow in the card's top-left corner (beside the logo). */
  backHref?: string;
  backLabel?: string;
}

/** Title block for auth pages. Place first inside the AuthLayout card (the frame renders the logo). */
export function AuthCardHeader({ title, subtitle, backHref, backLabel = "Back" }: AuthCardHeaderProps) {
  return (
    <div className="mb-6 text-center sm:mb-7">
      {backHref ? (
        <Link
          href={backHref}
          aria-label={backLabel}
          className={iconButtonClasses({ className: "absolute left-2 top-4 text-ink sm:left-4 sm:top-6" })}
        >
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        </Link>
      ) : null}
      <h1 className="font-heading text-[26px] font-bold leading-8 text-ink text-balance sm:text-[1.75rem] sm:leading-9">{title}</h1>
      {subtitle ? <div className="mx-auto mt-2 max-w-[22rem] text-base text-ink-muted">{subtitle}</div> : null}
    </div>
  );
}
