import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface SectionHeaderProps {
  id: string;
  title: ReactNode;
  /** Right-aligned action, usually a <SectionLink>. */
  action?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}

/**
 * Heading row above a dashboard section. Always 44px tall (the tap height of its link), so sibling
 * sections line up whether or not they have a "View all" action.
 */
export function SectionHeader({ id, title, action, as: Heading = "h2", className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-2 flex min-h-11 items-center justify-between gap-3", className)}>
      <Heading id={id} className="type-h3 text-ink">
        {title}
      </Heading>
      {action}
    </div>
  );
}

/** "View all" style link for a SectionHeader action. */
export function SectionLink({ href, children = "View all" }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm text-sm font-semibold text-green-700 underline-offset-4 transition-colors hover:text-green-800 hover:underline"
    >
      {children}
      <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
    </Link>
  );
}
