"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, FormField, IconButton, Input, Select } from "@/components/ui";
import { MAX_ADDITIONAL_CHARGES, type AdditionalChargeDTO } from "@/lib/api/contracts/agency";

/** One editable row; `amount` stays a string while typing. */
export interface ChargeRow {
  key: string;
  label: string;
  amount: string;
  basis: AdditionalChargeDTO["basis"];
}

const BASIS_OPTIONS = [
  { value: "per_booking", label: "Every booking" },
  { value: "special_handling_only", label: "Special handling only" },
] as const;

let seq = 0;
export const newChargeRow = (c?: AdditionalChargeDTO): ChargeRow => ({
  key: `c${++seq}`,
  label: c?.label ?? "",
  amount: c ? String(c.amountRupees) : "",
  basis: c?.basis ?? "per_booking",
});

/** Validates rows → API charges, or per-row field errors (`{index}.label` / `{index}.amount`). */
export function parseCharges(rows: ChargeRow[]): { charges: AdditionalChargeDTO[] | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const charges = rows.map((r, i) => {
    const label = r.label.trim().replace(/\s+/g, " ");
    if (label.length < 2) errors[`${i}.label`] = "Name the charge (at least 2 characters)";
    else if (label.length > 40) errors[`${i}.label`] = "Use at most 40 characters";
    else if (seen.has(label.toLowerCase())) errors[`${i}.label`] = "Each charge needs a different name";
    seen.add(label.toLowerCase());
    const amount = Number(r.amount.trim());
    if (!r.amount.trim() || !/^\d+$/.test(r.amount.trim())) errors[`${i}.amount`] = "Enter whole rupees, e.g. 200";
    else if (amount > 5000) errors[`${i}.amount`] = "At most ₹5,000";
    return { label, amountRupees: amount, basis: r.basis };
  });
  return { charges: Object.keys(errors).length ? null : charges, errors };
}

export interface AdditionalChargesEditorProps {
  rows: ChargeRow[];
  onChange(rows: ChargeRow[]): void;
  /** Keys `{index}.label` / `{index}.amount` (local or server `additionalCharges.{i}.*`). */
  errors: Record<string, string>;
}

/**
 * M4: "Additional charges" repeater on Add Trip step 2 — up to five named, fixed rupee amounts (loading,
 * toll, packing…), each charged on every booking or only on bookings that need special handling. They are
 * added to the customer's price line by line and paid to the agency.
 */
export function AdditionalChargesEditor({ rows, onChange, errors }: AdditionalChargesEditorProps) {
  const update = (i: number, patch: Partial<ChargeRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="type-h3 mb-1 text-ink">Additional charges</legend>
      <p className="-mt-2 text-sm text-ink-muted">
        Optional fixed charges, such as loading or tolls. Customers see each one in their price breakdown. Up to {MAX_ADDITIONAL_CHARGES}.
      </p>
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-start">
          <FormField label="Charge" htmlFor={`charge-${r.key}-label`} error={errors[`${i}.label`]} required>
            <Input id={`charge-${r.key}-label`} value={r.label} maxLength={40} placeholder="e.g. Loading" invalid={!!errors[`${i}.label`]} onChange={(e) => update(i, { label: e.target.value })} />
          </FormField>
          <FormField label="Amount" htmlFor={`charge-${r.key}-amount`} error={errors[`${i}.amount`]} required>
            <Input
              id={`charge-${r.key}-amount`}
              inputMode="numeric"
              prefix="₹"
              className="tabular-nums"
              value={r.amount}
              invalid={!!errors[`${i}.amount`]}
              onChange={(e) => update(i, { amount: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })}
            />
          </FormField>
          <FormField label="Applies to" htmlFor={`charge-${r.key}-basis`}>
            <Select
              id={`charge-${r.key}-basis`}
              options={[...BASIS_OPTIONS]}
              value={r.basis}
              onChange={(e) => update(i, { basis: e.target.value as ChargeRow["basis"] })}
            />
          </FormField>
          <IconButton
            label={`Remove ${r.label.trim() || "this charge"}`}
            icon={<Trash2 strokeWidth={1.75} />}
            variant="ghost"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="self-end sm:mt-7"
          />
        </div>
      ))}
      {rows.length < MAX_ADDITIONAL_CHARGES ? (
        <Button type="button" variant="ghost" size="sm" leadingIcon={<Plus aria-hidden="true" strokeWidth={2} />} onClick={() => onChange([...rows, newChargeRow()])} className="self-start">
          Add a charge
        </Button>
      ) : null}
    </fieldset>
  );
}
