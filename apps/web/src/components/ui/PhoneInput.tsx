import { Input, type InputProps } from "./Input";

export type PhoneInputProps = Omit<InputProps, "type" | "prefix" | "leadingIcon">;

function IndiaFlag() {
  return (
    <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" className="shrink-0 rounded-[3px] ring-1 ring-border">
      <rect width="24" height="16" className="fill-white" />
      <rect width="24" height="5.33" className="fill-flag-saffron" />
      <rect y="10.67" width="24" height="5.33" className="fill-flag-green" />
      <circle cx="12" cy="8" r="2.1" fill="none" className="stroke-flag-navy" strokeWidth="0.6" />
      <circle cx="12" cy="8" r="0.45" className="fill-flag-navy" />
    </svg>
  );
}

/**
 * Indian mobile number field: flag + "+91" prefix, numeric keyboard, 10 digits.
 * Value is the 10-digit national number (no +91). Validation lives in the form schema.
 */
export function PhoneInput({ placeholder = "Enter mobile number", maxLength = 10, ...rest }: PhoneInputProps) {
  return (
    <Input
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      pattern="[0-9]*"
      maxLength={maxLength}
      placeholder={placeholder}
      prefix={
        <>
          <IndiaFlag />
          <span className="font-heading font-semibold tabular-nums">+91</span>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
        </>
      }
      {...rest}
    />
  );
}
