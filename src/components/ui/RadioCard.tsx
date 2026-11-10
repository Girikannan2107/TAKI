import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface RadioCardProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size"> {
  /** Native radio value. Group radios with the same `name` inside a <fieldset><legend>. */
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Extra content on the right before the radio (e.g. a price). */
  aside?: ReactNode;
}

/**
 * Whole-row clickable radio (payment methods, options). Uses a real <input type="radio">
 * so arrow-key navigation and form semantics are native.
 */
export function RadioCard({ label, description, icon, aside, className, disabled, ...rest }: RadioCardProps) {
  return (
    <label
      className={cn(
        "group relative flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface p-4 transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-border-strong",
        "has-[:checked]:border-[1.5px] has-[:checked]:border-green-500 has-[:checked]:bg-green-50",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green-700",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-muted text-green-700 [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-heading text-[15px] font-semibold text-ink">{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
      {aside ? <span className="shrink-0">{aside}</span> : null}
      <input
        type="radio"
        disabled={disabled}
        className="size-5 shrink-0 cursor-pointer accent-green-700 focus-visible:outline-none disabled:cursor-not-allowed"
        {...rest}
      />
    </label>
  );
}
