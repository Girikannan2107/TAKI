import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps extends ComponentPropsWithRef<"div"> {
  as?: "div" | "section" | "article" | "li";
  padding?: "none" | "sm" | "md" | "lg";
  /** default = white card; muted = flat grey panel; brand = dark-green gradient (earnings); selected = green border + tint. */
  tone?: "default" | "muted" | "brand" | "selected";
  /** Hover lift (shadow-raised + stronger border). Use when the card (or a stretched link inside) is clickable. */
  interactive?: boolean;
}

const paddings = {
  none: "",
  sm: "p-4",
  md: "p-5 lg:p-6",
  lg: "p-6 lg:p-8",
} as const;

const tones = {
  default: "border border-border bg-surface shadow-card",
  muted: "border border-transparent bg-surface-muted",
  brand: "border border-transparent bg-green-700 bg-grad-earnings text-white shadow-raised",
  selected: "border-[1.5px] border-green-500 bg-green-50 ring-4 ring-green-500/10",
} as const;

export function Card({ as = "div", padding = "md", tone = "default", interactive, className, ...rest }: CardProps) {
  const Comp = as as "div";
  return (
    <Comp
      data-surface={tone === "brand" ? "dark" : undefined}
      className={cn(
        "relative min-w-0 rounded-lg",
        tones[tone],
        paddings[padding],
        interactive &&
          "transition-[box-shadow,border-color,transform] duration-200 ease-out hover:border-border-strong hover:shadow-raised",
        className,
      )}
      {...rest}
    />
  );
}
