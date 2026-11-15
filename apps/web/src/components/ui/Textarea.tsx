"use client";

import { useState, type ChangeEvent, type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
  /** Show a live "n / maxLength" counter under the field (needs `maxLength`). Default true when maxLength is set. */
  showCount?: boolean;
  wrapperClassName?: string;
}

/**
 * Multi-line text field styled like Input (white, 1px border, radius md, green focus ring).
 * Works inside FormField (id / aria-* are forwarded to the <textarea>). Controlled or uncontrolled.
 */
export function Textarea({
  invalid,
  showCount,
  maxLength,
  rows = 3,
  className,
  wrapperClassName,
  onChange,
  value,
  defaultValue,
  "aria-invalid": ariaInvalid,
  id,
  "aria-describedby": describedBy,
  ...rest
}: TextareaProps) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === "true";
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? "").length);
  const length = value !== undefined ? String(value ?? "").length : uncontrolledLength;
  const counter = (showCount ?? maxLength !== undefined) && maxLength !== undefined;
  const counterId = counter && id ? `${id}-count` : undefined;

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    if (value === undefined) setUncontrolledLength(e.target.value.length);
    onChange?.(e);
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", wrapperClassName)}>
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        aria-invalid={isInvalid || undefined}
        aria-describedby={[describedBy, counterId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "block min-h-12 w-full min-w-0 resize-y rounded-md border border-border bg-surface px-3.5 py-3 text-base text-ink",
          "placeholder:text-ink-subtle transition-[border-color,box-shadow] duration-150 hover:border-border-strong",
          "focus-visible:border-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700",
          "aria-invalid:border-error aria-invalid:focus-visible:outline-error",
          "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70",
          className,
        )}
        {...rest}
      />
      {counter ? (
        <p id={counterId} className="self-end text-caption tabular-nums text-ink-subtle">
          <span aria-hidden="true">
            {length} / {maxLength}
          </span>
          <span className="sr-only">
            {length} of {maxLength} characters used
          </span>
        </p>
      ) : null}
    </div>
  );
}
