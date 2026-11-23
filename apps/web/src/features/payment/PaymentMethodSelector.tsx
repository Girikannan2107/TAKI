"use client";

import { Building2, CreditCard, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { RadioCard } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export type PaymentMethod = "upi" | "card" | "netbanking";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Credit / Debit Card",
  netbanking: "Net Banking",
};

const METHODS: ReadonlyArray<{ value: PaymentMethod; icon: ReactNode }> = [
  { value: "upi", icon: <Smartphone strokeWidth={1.75} /> },
  { value: "card", icon: <CreditCard strokeWidth={1.75} /> },
  { value: "netbanking", icon: <Building2 strokeWidth={1.75} /> },
];

/**
 * "Choose Payment Method" — a native radio group (arrow keys move the selection).
 * Collects NO card, UPI or bank details: on the dev gateway the method is only a label.
 */
export function PaymentMethodSelector({
  value,
  onChange,
  disabled,
  className,
}: {
  value: PaymentMethod;
  onChange(m: PaymentMethod): void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className="type-h3 mb-4 text-ink">Choose Payment Method</legend>
      <div className="flex flex-col gap-3">
        {METHODS.map((m) => (
          <RadioCard
            key={m.value}
            name="payment-method"
            value={m.value}
            label={PAYMENT_METHOD_LABEL[m.value]}
            icon={m.icon}
            checked={value === m.value}
            onChange={() => onChange(m.value)}
            disabled={disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}
