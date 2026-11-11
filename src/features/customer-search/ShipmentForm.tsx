"use client";

import { useState, type ChangeEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, ArrowUpDown, Calendar, ChevronDown, MapPin } from "lucide-react";
import { Button, FormField, IconButton, Input, Select, type InputProps } from "@/components/ui";
import { CITIES, cityLabel } from "@/lib/domain/cities";
import type { City, IsoDate } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { isIsoDate } from "@/lib/domain/dates";
import {
  kgToUnitString,
  maxPickupDate,
  shipmentFormSchema,
  weightToKg,
  WEIGHT_UNITS,
  type ShipmentFormValues,
  type WeightUnit,
} from "@/lib/schemas/shipment-search.schema";
import { cn } from "@/lib/utils/cn";

export interface ShipmentFormProps {
  defaultValues: ShipmentFormValues;
  /** IST calendar date used for the pickup-date bounds. */
  today: IsoDate;
  cities?: readonly City[];
  onSubmit(values: ShipmentFormValues): void | Promise<void>;
  submitLabel?: string;
}

/** Dashboard "New Shipment" form (Source, Destination, Cargo Weight, Pickup Date). */
export function ShipmentForm({ defaultValues, today, cities = CITIES, onSubmit, submitLabel = "Find Available Vehicles" }: ShipmentFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    control,
    formState: { errors },
  } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema(today)),
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const cityOptions = cities.map((c) => ({ value: c.id, label: cityLabel(c.id) }));
  const date = useWatch({ control, name: "date" });
  const unitReg = register("unit");

  function onUnitChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as WeightUnit;
    const prev = getValues("unit");
    const kg = weightToKg(getValues("weight"), prev);
    void unitReg.onChange(e);
    if (kg !== null && next !== prev) setValue("weight", kgToUnitString(kg, next), { shouldValidate: !!errors.weight });
  }

  function swapCities() {
    const { from, to } = getValues();
    const validate = !!(errors.from || errors.to);
    setValue("from", to, { shouldValidate: validate, shouldDirty: true });
    setValue("to", from, { shouldValidate: validate, shouldDirty: true });
  }

  return (
    <form
      noValidate
      aria-label="New shipment"
      onSubmit={handleSubmit(async (values) => {
        setSubmitting(true);
        try {
          await onSubmit(values);
        } catch {
          setSubmitting(false);
        }
      })}
      className="flex flex-col gap-5"
    >
      <FormField label="Source" htmlFor="shipment-from" error={errors.from?.message} required>
        <Select
          leadingIcon={<MapPin strokeWidth={1.75} />}
          options={cityOptions}
          placeholder="Select pickup city"
          autoComplete="off"
          {...register("from", { deps: ["to"] })}
        />
      </FormField>

      <div className="relative">
        <IconButton
          label="Swap source and destination"
          icon={<ArrowUpDown strokeWidth={1.75} />}
          size="sm"
          variant="surface"
          onClick={swapCities}
          className="absolute -top-2 right-0 z-10 [&_svg]:size-4"
        />
        <FormField label="Destination" htmlFor="shipment-to" error={errors.to?.message} required>
          <Select
            leadingIcon={<MapPin strokeWidth={1.75} />}
            options={cityOptions}
            placeholder="Select drop city"
            autoComplete="off"
            {...register("to", { deps: ["from"] })}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField label="Cargo Weight" htmlFor="shipment-weight" error={errors.weight?.message} required>
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 500"
            className="tabular-nums"
            trailingSlot={
              <span className="relative flex items-center">
                <select
                  aria-label="Weight unit"
                  {...unitReg}
                  onChange={onUnitChange}
                  className="h-11 appearance-none rounded-sm bg-transparent pl-2 pr-7 text-base font-medium text-ink hover:bg-surface-muted"
                >
                  {WEIGHT_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" strokeWidth={1.75} className="pointer-events-none absolute right-1.5 size-4 text-ink-muted" />
              </span>
            }
            {...register("weight")}
          />
        </FormField>

        <FormField label="Pickup Date" htmlFor="shipment-date" error={errors.date?.message} required>
          <DateInput display={date && isIsoDate(date) ? formatDate(date) : undefined} min={today} max={maxPickupDate(today)} {...register("date")} />
        </FormField>
      </div>

      <Button type="submit" size="lg" fullWidth loading={submitting} trailingIcon={<ArrowRight strokeWidth={2} />} className="mt-1">
        {submitting ? "Finding vehicles…" : submitLabel}
      </Button>
    </form>
  );
}

/**
 * Native date input with a calendar icon. While not focused it shows the value as
 * "20 Nov, 2025" (as on the reference); the native control stays fully usable.
 */
function DateInput({ display, className, ...props }: InputProps & { display?: string }) {
  return (
    <div className="group relative">
      <Input
        type="date"
        leadingIcon={<Calendar strokeWidth={1.75} />}
        className={cn(
          "cursor-pointer tabular-nums",
          "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          display && "text-transparent focus:text-ink",
          className,
        )}
        {...props}
      />
      {display ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[42px] right-3 flex items-center truncate text-base text-ink tabular-nums group-focus-within:hidden"
        >
          {display}
        </span>
      ) : null}
    </div>
  );
}
