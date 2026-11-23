import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { fieldBoxClasses } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "children"> {
  options: SelectOption[];
  /** Grouped options (<optgroup>), rendered after `options`. E.g. districts grouped by state. */
  groups?: SelectOptionGroup[];
  /** Renders a first empty, disabled option (e.g. "Select vehicle type"). */
  placeholder?: string;
  leadingIcon?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
}

/** Native <select> styled like Input (robust on mobile, fully accessible). */
export function Select({
  options,
  groups,
  placeholder,
  leadingIcon,
  invalid,
  wrapperClassName,
  className,
  "aria-invalid": ariaInvalid,
  ...rest
}: SelectProps) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === "true";
  return (
    <div className={cn(fieldBoxClasses, wrapperClassName)}>
      {leadingIcon ? (
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 flex text-green-500 [&_svg]:size-[18px]">
          {leadingIcon}
        </span>
      ) : null}
      <select
        aria-invalid={isInvalid || undefined}
        className={cn(
          "h-full w-full min-w-0 appearance-none truncate rounded-md bg-transparent pl-3.5 pr-10 text-base text-ink outline-none",
          "focus-visible:outline-none disabled:cursor-not-allowed",
          leadingIcon && "pl-10",
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute right-3.5 size-[18px] text-ink-muted"
      />
    </div>
  );
}
