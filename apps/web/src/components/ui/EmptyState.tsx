import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button, ButtonLink } from "./Button";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href: string } | { label: string; onClick(): void };
  /** Heading level for the title (default 2 — pages own the h1). */
  headingLevel?: 2 | 3;
  className?: string;
}

export function EmptyState({ icon, title, description, action, headingLevel = 2, className }: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-4 flex size-14 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-7"
      >
        {icon ?? <Inbox strokeWidth={1.75} />}
      </span>
      <Heading className="type-h3 text-ink">{title}</Heading>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {action ? (
        <div className="mt-5">
          {"href" in action ? (
            <ButtonLink href={action.href}>{action.label}</ButtonLink>
          ) : (
            <Button onClick={action.onClick}>{action.label}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
