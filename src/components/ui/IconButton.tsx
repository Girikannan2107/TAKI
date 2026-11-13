import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  /** Required accessible name (aria-label). Include counts if relevant, e.g. "Notifications, 3 unread". */
  label: string;
  icon: ReactNode;
  variant?: "ghost" | "surface";
  size?: "sm" | "md";
  /** number = count pill, true = dot. Decorative (aria-hidden) — put the meaning in `label`. */
  badge?: number | boolean;
}

/** Classes so links (e.g. back arrows) can look exactly like an IconButton. */
export function iconButtonClasses({
  variant = "ghost",
  size = "md",
  className,
}: { variant?: "ghost" | "surface"; size?: "sm" | "md"; className?: string } = {}) {
  return cn(
    "relative inline-flex shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-150",
    "disabled:cursor-not-allowed disabled:opacity-45",
    "[&_svg]:size-5 [&_svg]:shrink-0",
    size === "md" ? "size-11" : "size-9 pointer-coarse:size-11",
    variant === "ghost" ? "hover:bg-ink/6" : "border border-border bg-surface shadow-card hover:border-border-strong",
    className,
  );
}

export function IconButton({ label, icon, variant, size, badge, className, type = "button", ...rest }: IconButtonProps) {
  const count = typeof badge === "number" && badge > 0 ? badge : 0;
  return (
    <button type={type} aria-label={label} className={iconButtonClasses({ variant, size, className })} {...rest}>
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-surface"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      {badge === true ? (
        <span aria-hidden="true" className="absolute right-2.5 top-2.5 size-2.5 rounded-full bg-coral-400 ring-2 ring-surface" />
      ) : null}
    </button>
  );
}
