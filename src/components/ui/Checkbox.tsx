import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size"> {
  /** Visible label (clickable). May contain a link, e.g. "I agree to the <a>Terms</a>". */
  label: ReactNode;
  description?: ReactNode;
  /** Inline error under the checkbox (sets aria-invalid). */
  error?: string;
}

/** Native checkbox with label, optional description and error. 44px touch target on coarse pointers. */
export function Checkbox({ label, description, error, id: idProp, className, disabled, "aria-describedby": describedBy, ...rest }: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const descId = description ? `${id}-desc` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-start gap-3">
        <span className="flex h-6 shrink-0 items-center pointer-coarse:h-11">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={[describedBy, descId, errorId].filter(Boolean).join(" ") || undefined}
            className="size-5 cursor-pointer rounded-sm accent-green-700 disabled:cursor-not-allowed"
            {...rest}
          />
        </span>
        <span className="min-w-0 pt-0.5 pointer-coarse:pt-2.5">
          <label htmlFor={id} className={cn("text-[15px] leading-5 text-ink", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
            {label}
          </label>
          {description ? (
            <span id={descId} className="mt-0.5 block text-sm text-ink-muted">
              {description}
            </span>
          ) : null}
        </span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 pl-8 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
