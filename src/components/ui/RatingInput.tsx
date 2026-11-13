"use client";

import { useId, useState } from "react";
import { CircleAlert, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface RatingInputProps {
  value: number | null;
  onChange(value: 1 | 2 | 3 | 4 | 5): void;
  /** Native radio group name. */
  name?: string;
  /** Visible group label. Default "Your rating". */
  legend?: string;
  hideLegend?: boolean;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

const WORDS = ["Poor", "Fair", "Good", "Very good", "Excellent"] as const;

/** 5-star rating as a native radio group (arrow keys work); 44px targets; hover preview on fine pointers. */
export function RatingInput({
  value,
  onChange,
  name,
  legend = "Your rating",
  hideLegend,
  error,
  required,
  disabled,
  className,
}: RatingInputProps) {
  const autoId = useId();
  const groupName = name ?? autoId;
  const errorId = error ? `${autoId}-error` : undefined;
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <fieldset
      className={cn("min-w-0", className)}
      disabled={disabled}
      aria-describedby={errorId}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className={cn("mb-1 text-sm font-medium text-ink", hideLegend && "sr-only")}>{legend}</legend>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= shown;
          return (
            <label
              key={n}
              onMouseEnter={() => setHover(n)}
              className={cn(
                "relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-ink/5",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-green-700",
                disabled && "cursor-not-allowed",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={n}
                checked={value === n}
                onChange={() => onChange(n as 1 | 2 | 3 | 4 | 5)}
                className="sr-only"
              />
              <Star
                aria-hidden="true"
                strokeWidth={1.5}
                className={cn("size-7", filled ? "fill-star text-star" : "fill-transparent text-border-strong")}
              />
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"}, {WORDS[n - 1]}
              </span>
            </label>
          );
        })}
        <span aria-hidden="true" className="ml-2 min-w-20 text-sm font-medium text-ink-muted">
          {shown > 0 ? WORDS[shown - 1] : ""}
        </span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
