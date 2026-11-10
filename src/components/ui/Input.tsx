import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size" | "prefix"> {
  /** Decorative icon on the left, e.g. <MapPin />. Rendered aria-hidden. */
  leadingIcon?: ReactNode;
  /** Right-hand slot: unit text ("/ km", "kg") or a control (password eye IconButton). */
  trailingSlot?: ReactNode;
  /** Left-hand inline content before the text, e.g. flag + "+91" or "₹". */
  prefix?: ReactNode;
  invalid?: boolean;
  /** Classes for the outer field wrapper (border/background box). `className` goes on the <input>. */
  wrapperClassName?: string;
}

/** Wrapper styles shared by Input / Select so fields line up (48px, white, 1px border, radius md). */
export const fieldBoxClasses = cn(
  "relative flex h-12 w-full min-w-0 items-center rounded-md border border-border bg-surface text-ink",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-border-strong",
  "has-[:is(input,select,textarea):focus-visible]:border-green-700 has-[:is(input,select,textarea):focus-visible]:outline-2 has-[:is(input,select,textarea):focus-visible]:outline-offset-2 has-[:is(input,select,textarea):focus-visible]:outline-green-700",
  "has-[[aria-invalid=true]]:border-error has-[[aria-invalid=true]]:outline-error",
  "has-[:is(input,select,textarea):disabled]:cursor-not-allowed has-[:is(input,select,textarea):disabled]:bg-surface-muted has-[:is(input,select,textarea):disabled]:opacity-70",
);

export function Input({
  leadingIcon,
  trailingSlot,
  prefix,
  invalid,
  wrapperClassName,
  className,
  type = "text",
  "aria-invalid": ariaInvalid,
  ...rest
}: InputProps) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === "true";
  return (
    <div className={cn(fieldBoxClasses, wrapperClassName)}>
      {leadingIcon ? (
        <span aria-hidden="true" className="pointer-events-none flex shrink-0 pl-3.5 text-green-500 [&_svg]:size-[18px]">
          {leadingIcon}
        </span>
      ) : null}
      {prefix ? <span className="flex shrink-0 items-center gap-2 pl-3.5 font-medium text-ink">{prefix}</span> : null}
      <input
        type={type}
        aria-invalid={isInvalid || undefined}
        className={cn(
          "h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-3.5 text-base text-ink outline-none placeholder:text-ink-subtle",
          "focus-visible:outline-none disabled:cursor-not-allowed",
          (leadingIcon || prefix) && "pl-2.5",
          trailingSlot && "pr-2",
          className,
        )}
        {...rest}
      />
      {trailingSlot ? (
        <span className="flex shrink-0 items-center pr-1.5 text-sm text-ink-muted">{trailingSlot}</span>
      ) : null}
    </div>
  );
}
