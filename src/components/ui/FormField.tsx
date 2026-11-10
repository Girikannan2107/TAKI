import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface FormFieldProps {
  label: string;
  /** id of the control. FormField injects it into the child if the child has no id. */
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Show a muted "(optional)" tag after the label. */
  optionalLabel?: boolean;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

/**
 * Label + control + hint + error. Wires `id`, `aria-describedby`, `aria-invalid` and `aria-required`
 * into its single child element (Input, Select, PasswordInput, PhoneInput, textarea…).
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  optionalLabel,
  hideLabel,
  children,
  className,
}: FormFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  let control = children;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  if (isValidElement<ControlProps>(only)) {
    const el = only as ReactElement<ControlProps>;
    const describedBy = [el.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
    control = cloneElement(el, {
      id: el.props.id ?? htmlFor,
      "aria-describedby": describedBy,
      "aria-invalid": error ? true : el.props["aria-invalid"],
      "aria-required": required ? true : el.props["aria-required"],
    });
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className={cn("text-sm font-medium text-ink", hideLabel && "sr-only")}>
        {label}
        {optionalLabel ? <span className="ml-1 text-caption font-medium text-ink-subtle">(optional)</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-[13px] leading-5 text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
