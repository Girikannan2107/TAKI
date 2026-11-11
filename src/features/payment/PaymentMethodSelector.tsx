"use client";

import { Building2, CreditCard, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { RadioCard } from "@/components/ui";
import { paymentMethodLabel } from "@/lib/domain/labels";
import type { PaymentMethod } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

const METHODS: ReadonlyArray<{ value: PaymentMethod; icon: ReactNode }> = [
  { value: "upi", icon: <Smartphone strokeWidth={1.75} /> },
  { value: "card", icon: <CreditCard strokeWidth={1.75} /> },
  { value: "netbanking", icon: <Building2 strokeWidth={1.75} /> },
];

/**
 * "Choose Payment Method" — a native radio group (arrow keys move the selection).
 * Collects NO card, UPI or bank details: the method is only a label on the demo payment.
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
            label={paymentMethodLabel(m.value)}
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
