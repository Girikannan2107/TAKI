"use client";

import { useId, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ChoiceOption<V extends string = string> {
  value: V;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface ChoiceChipsBase<V extends string> {
  /** Visible group label (rendered as the <legend>). */
  legend: string;
  hideLegend?: boolean;
  options: ReadonlyArray<ChoiceOption<V>>;
  /** Native input `name`. Defaults to a generated id. */
  name?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export interface ChoiceChipsSingleProps<V extends string = string> extends ChoiceChipsBase<V> {
  multiple?: false;
  value: V | null | undefined;
  onChange(value: V): void;
}

export interface ChoiceChipsMultiProps<V extends string = string> extends ChoiceChipsBase<V> {
  multiple: true;
  value: readonly V[];
  onChange(value: V[]): void;
}

export type ChoiceChipsProps<V extends string = string> = ChoiceChipsSingleProps<V> | ChoiceChipsMultiProps<V>;

/**
 * Pill-shaped choices in a <fieldset>. Single = native radios (arrow keys), multiple = native checkboxes.
 * Selected = mint fill + green text + check icon (never colour alone). Wraps on narrow screens.
 */
export function ChoiceChips<V extends string = string>(props: ChoiceChipsProps<V>) {
  const { legend, hideLegend, options, hint, error, required, disabled, className } = props;
  const autoId = useId();
  const name = props.name ?? autoId;
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;

  function isChecked(v: V): boolean {
    return props.multiple ? props.value.includes(v) : props.value === v;
  }

  function toggle(v: V) {
    if (props.multiple) {
      const set = new Set(props.value);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      // keep option order stable
      props.onChange(options.map((o) => o.value).filter((x) => set.has(x)));
    } else {
      props.onChange(v);
    }
  }

  return (
    <fieldset
      className={cn("min-w-0", className)}
      aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      disabled={disabled}
    >
      <legend className={cn("mb-1.5 text-sm font-medium text-ink", hideLegend && "sr-only")}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = isChecked(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "relative inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green-700",
                checked
                  ? "border-green-500 bg-mint-100 text-green-800"
                  : "border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-muted",
                (o.disabled || disabled) && "cursor-not-allowed opacity-50",
                error && !checked && "border-error/60",
              )}
            >
              <input
                type={props.multiple ? "checkbox" : "radio"}
                name={name}
                value={o.value}
                checked={checked}
                disabled={o.disabled || disabled}
                onChange={() => toggle(o.value)}
                className="sr-only"
              />
              {checked ? (
                <Check aria-hidden="true" strokeWidth={2.25} className="size-4 shrink-0" />
              ) : o.icon ? (
                <span aria-hidden="true" className="inline-flex [&_svg]:size-4">
                  {o.icon}
                </span>
              ) : null}
              <span className="whitespace-nowrap">{o.label}</span>
            </label>
          );
        })}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-[13px] leading-5 text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
