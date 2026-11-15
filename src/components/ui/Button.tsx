import Link from "next/link";
import type { ComponentProps, ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "./Spinner";

/** accent = light-green accent — one "create" CTA per screen (Ship Goods, New Shipment, Add Trip). Dark text on it. */
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "lime" | "ghost-dark" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. Keep children as the progress text ("Sending…"). */
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export type ButtonProps = ButtonBaseProps & ComponentPropsWithRef<"button">;
export type ButtonLinkProps = ButtonBaseProps & Omit<ComponentProps<typeof Link>, "className"> & { className?: string };

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-green-700 bg-grad-primary text-white shadow-btn hover:bg-grad-primary-hover hover:shadow-btn-hover motion-safe:hover:-translate-y-px",
  secondary: "bg-mint-100 text-green-800 hover:bg-green-300/70",
  outline: "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "bg-transparent text-green-700 hover:bg-surface-muted",
  lime: "bg-lime-300 text-green-950 hover:bg-lime-400 motion-safe:hover:-translate-y-px",
  "ghost-dark": "border-[1.5px] border-lime-300/70 bg-green-950/30 text-white hover:border-lime-300 hover:bg-white/10",
  danger: "bg-error text-white hover:bg-error-strong",
  accent: "bg-lime-300 text-green-950 hover:bg-lime-400 motion-safe:hover:-translate-y-px",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3.5 text-sm pointer-coarse:min-h-11",
  md: "h-11 gap-2 px-5 text-base",
  lg: "h-13 gap-2 px-6 text-base",
};

/** Class builder so other elements (e.g. a <label> or <summary>) can look like a Button. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}) {
  return cn(
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-heading font-semibold",
    "transition-[background-color,box-shadow,transform,border-color,color] duration-150 ease-out",
    "active:translate-y-0 active:shadow-none active:brightness-95",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
    "aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    "[&_svg]:shrink-0",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
    className,
  );
}

function Content({ loading, leadingIcon, trailingIcon, children }: ButtonBaseProps & { children?: ReactNode }) {
  return (
    <>
      {loading ? (
        <Spinner size="sm" label="" />
      ) : leadingIcon ? (
        <span aria-hidden="true" className="inline-flex">
          {leadingIcon}
        </span>
      ) : null}
      {children}
      {trailingIcon && !loading ? (
        <span aria-hidden="true" className="inline-flex">
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
}

export function Button({
  variant,
  size,
  loading = false,
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      <Content loading={loading} leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </button>
  );
}

/** next/link styled as a Button. For a disabled look pass `aria-disabled` (prefer not rendering a dead link). */
export function ButtonLink({
  variant,
  size,
  loading = false,
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link aria-busy={loading || undefined} className={buttonClasses({ variant, size, fullWidth, className })} {...rest}>
      <Content loading={loading} leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </Link>
  );
}
