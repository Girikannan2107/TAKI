import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

/** Eyebrow + h2 + intro used by the landing sections below the hero. */
export function SectionHeading({ id, eyebrow, title, children, align = "left", className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-green-700">{eyebrow}</p>
      <h2 id={id} className="mt-3 font-heading text-[1.75rem] font-bold leading-[1.2] tracking-[-0.01em] text-ink sm:text-[2.125rem]">
        {title}
      </h2>
      {children ? <div className="mt-4 text-base leading-7 text-ink-muted sm:text-lg">{children}</div> : null}
    </div>
  );
}
