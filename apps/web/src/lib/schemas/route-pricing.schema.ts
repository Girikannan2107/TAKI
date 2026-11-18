/**
 * Set Pricing form (D8). Rates are typed in rupees (max 2 decimals) and stored
 * as integer paise. Limits come from LIMITS (data-contract.md §5).
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import { paiseToRupeesString, rupeesToPaise } from "@/lib/domain/pricing";
import type { Paise } from "@/lib/domain/types";

function rateField(opts: { label: string; requiredMessage: string; minPaise: number; maxPaise: number }) {
  const rangeMessage = `${opts.label} must be between ₹${paiseToRupeesString(opts.minPaise)} and ₹${paiseToRupeesString(opts.maxPaise)}`;
  return z.string().superRefine((raw, ctx) => {
    const value = raw.trim();
    if (value === "") {
      ctx.addIssue({ code: "custom", message: opts.requiredMessage });
      return;
    }
    if (!/^-?\d*\.?\d*$/.test(value) || value === "." || value === "-" || Number.isNaN(Number(value))) {
      ctx.addIssue({ code: "custom", message: "Enter a number, e.g. 12 or 0.50" });
      return;
    }
    if (Number(value) < 0 || value.startsWith("-")) {
      ctx.addIssue({ code: "custom", message: `${opts.label} can't be negative` });
      return;
    }
    if (/\.\d{3,}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Use up to 2 decimal places" });
      return;
    }
    const paise = rupeesToPaise(value.endsWith(".") ? value.slice(0, -1) : value);
    if (Number.isNaN(paise)) {
      ctx.addIssue({ code: "custom", message: "Enter a number, e.g. 12 or 0.50" });
      return;
    }
    if (paise < opts.minPaise || paise > opts.maxPaise) ctx.addIssue({ code: "custom", message: rangeMessage });
  });
}

export const routePricingSchema = z.object({
  ratePerKm: rateField({
    label: "Per kilometre rate",
    requiredMessage: "Enter your per kilometre rate",
    minPaise: LIMITS.ratePerKmPaise.min,
    maxPaise: LIMITS.ratePerKmPaise.max,
  }),
  ratePerKg: rateField({
    label: "Per kilogram rate",
    requiredMessage: "Enter your per kilogram rate",
    minPaise: LIMITS.ratePerKgPaise.min,
    maxPaise: LIMITS.ratePerKgPaise.max,
  }),
});

export type RoutePricingInput = z.infer<typeof routePricingSchema>;

/** Rupee string → paise, or null when the field is not a valid rate. */
export function ratePaiseOrNull(field: keyof RoutePricingInput, value: string): Paise | null {
  const result = routePricingSchema.shape[field].safeParse(value);
  if (!result.success) return null;
  const trimmed = value.trim();
  const paise = rupeesToPaise(trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed);
  return Number.isNaN(paise) ? null : paise;
}

/** Validated form values → paise for `publishRoute`. */
export function toRatePaise(values: RoutePricingInput): { ratePerKmPaise: Paise; ratePerKgPaise: Paise } {
  return {
    ratePerKmPaise: ratePaiseOrNull("ratePerKm", values.ratePerKm) ?? Number.NaN,
    ratePerKgPaise: ratePaiseOrNull("ratePerKg", values.ratePerKg) ?? Number.NaN,
  };
}
