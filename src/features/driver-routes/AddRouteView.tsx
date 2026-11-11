"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Calendar, CircleAlert, Clock, MapPin, Route as RouteIcon, Trash2, Truck } from "lucide-react";
import { Button, Card, Chip, ConfirmDialog, FormField, Input, Select, Skeleton, useToast, type InputProps } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { CITIES, cityLabel, cityName, isCityId } from "@/lib/domain/cities";
import { draftDistanceKm } from "@/lib/domain/commands";
import { LIMITS } from "@/lib/domain/constants";
import { isIsoDate, todayIst } from "@/lib/domain/dates";
import { estimateDurationMins } from "@/lib/domain/pricing";
import type { IsoDate } from "@/lib/domain/types";
import { getVehicleModel, maxPayloadForOption } from "@/lib/domain/vehicles";
import { formatDate, formatDuration, formatKm, formatNumber } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  DEPARTURE_TIME_OPTIONS,
  exampleRouteFormValues,
  isRouteDraftEmpty,
  maxTravelDate,
  parseKg,
  routeDraftFormSchema,
  routeDraftToFormValues,
  toRouteDraftPatch,
  type RouteDraftFormValues,
} from "@/lib/schemas/route-draft.schema";
import { useTakiStore } from "@/lib/store";
import { useVehicleOptions } from "@/lib/store/selectors";
import { getNow } from "@/lib/utils/clock";
import { cn } from "@/lib/utils/cn";

const ICON = { strokeWidth: 1.75 } as const;
const CITY_OPTIONS = CITIES.map((c) => ({ value: c.id, label: cityLabel(c.id) }));

/** "Tata 407 (TN 37 XX 4587) already has a route on 20 Nov, 2025" — or null when the vehicle is free that day. */
function vehicleClash(vehicleValue: string, date: IsoDate): string | null {
  const db = useTakiStore.getState().db;
  if (vehicleValue.startsWith("new:")) return null;
  const clash = Object.values(db.routes).find((r) => r.vehicleId === vehicleValue && r.status === "published" && r.travelDate === date);
  if (!clash) return null;
  const v = db.vehicles[vehicleValue];
  const name = v ? `${getVehicleModel(v.modelId)?.label ?? v.modelId} (${v.registrationNumber})` : "This vehicle";
  return `${name} already has a route on ${formatDate(date)}`;
}

/** Built per validation so "today", "now" and the vehicle data are always current. */
const resolver: Resolver<RouteDraftFormValues> = (values, context, options) => {
  const now = getNow();
  const schema = routeDraftFormSchema({
    today: todayIst(now),
    nowMs: now.getTime(),
    maxPayloadFor: (v) => maxPayloadForOption(useTakiStore.getState().db, v),
    vehicleClash,
  });
  return zodResolver(schema)(values, context, options);
};

/** Screen 12 — Add New Route (`/driver/routes/new`), step 1 of 2. */
export function AddRouteView() {
  const hydrated = useHydrated();
  const vehicleOptions = useVehicleOptions();
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader
        title="Add New Route"
        backHref={paths.driver.dashboard}
        backLabel="Back to dashboard"
        subtitle="Step 1 of 2 · Route details"
      />
      {hydrated && vehicleOptions.length > 0 ? <AddRouteForm /> : <FormSkeleton />}
    </div>
  );
}

function AddRouteForm() {
  const router = useRouter();
  const { toast } = useToast();
  const vehicleOptions = useVehicleOptions();
  const draft = useTakiStore((s) => s.routeDraft);
  const updateRouteDraft = useTakiStore((s) => s.updateRouteDraft);
  const clearRouteDraft = useTakiStore((s) => s.clearRouteDraft);
  const db = useTakiStore((s) => s.db);

  const [today] = useState(() => todayIst(getNow()));
  const exampleValues = useMemo(() => exampleRouteFormValues(today, vehicleOptions[0]), [today, vehicleOptions]);
  const [initialValues] = useState<RouteDraftFormValues>(() =>
    isRouteDraftEmpty(useTakiStore.getState().routeDraft)
      ? exampleValues
      : routeDraftToFormValues(useTakiStore.getState().routeDraft),
  );

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    subscribe,
    control,
    formState: { errors, isSubmitted },
  } = useForm<RouteDraftFormValues>({
    resolver,
    defaultValues: initialValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // Persist every user edit to the draft (back → dashboard keeps it). Resets (no field name) are not saved.
  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values, name }) => {
          if (name) updateRouteDraft(toRouteDraftPatch(values));
        },
      }),
    [subscribe, updateRouteDraft],
  );

  const [from, to, stops, date, vehicleId] = useWatch({ control, name: ["from", "to", "stops", "date", "vehicleId"] });
  const vehicleMax = vehicleId ? maxPayloadForOption(db, vehicleId) : undefined;
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasDraft = !isRouteDraftEmpty(draft);

  const vehicleSelectOptions = useMemo(() => vehicleOptions.map((o) => ({ value: o.value, label: o.label })), [vehicleOptions]);
  const vehicleReg = register("vehicleId", { deps: ["totalCapacity", "availableCapacity"] });

  function onVehicleChange(e: ChangeEvent<HTMLSelectElement>) {
    void vehicleReg.onChange(e);
    const max = maxPayloadForOption(db, e.target.value);
    const total = parseKg(getValues("totalCapacity"));
    if (max !== undefined && (total === null || total > max)) {
      setValue("totalCapacity", String(max), { shouldValidate: isSubmitted, shouldDirty: true });
    }
  }

  function setStops(next: string[]) {
    setValue("stops", next, { shouldValidate: isSubmitted, shouldDirty: true });
  }

  function discard() {
    clearRouteDraft();
    reset(exampleValues);
    setConfirmOpen(false);
    toast({ title: "Draft discarded", tone: "info" });
  }

  const onValid = (values: RouteDraftFormValues) => {
    setSubmitting(true);
    updateRouteDraft(toRouteDraftPatch(values));
    router.push(paths.driver.pricing);
  };

  return (
    <>
      <Card as="section" aria-label="Route details" padding="lg">
        <form noValidate aria-label="Add new route" onSubmit={handleSubmit(onValid)} className="flex flex-col gap-5">
          <FormField label="From" htmlFor="route-from" error={errors.from?.message} required>
            <Select
              leadingIcon={<MapPin {...ICON} />}
              options={CITY_OPTIONS}
              placeholder="Select starting city"
              {...register("from", { deps: ["to", "stops"] })}
            />
          </FormField>

          <FormField label="To" htmlFor="route-to" error={errors.to?.message} required>
            <Select
              leadingIcon={<MapPin {...ICON} />}
              options={CITY_OPTIONS}
              placeholder="Select destination city"
              {...register("to", { deps: ["from", "stops"] })}
            />
          </FormField>

          <StopsField
            stops={stops ?? []}
            from={from}
            to={to}
            error={errors.stops?.message ?? errors.stops?.root?.message}
            onChange={setStops}
          />

          <RouteSummary from={from} to={to} stops={stops ?? []} />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Travel Date" htmlFor="route-date" error={errors.date?.message} required>
              <DateInput
                display={date && isIsoDate(date) ? formatDate(date) : undefined}
                min={today}
                max={maxTravelDate(today)}
                {...register("date", { deps: ["time", "vehicleId"] })}
              />
            </FormField>
            <FormField label="Departure Time" htmlFor="route-time" error={errors.time?.message} required>
              <Select
                leadingIcon={<Clock {...ICON} />}
                options={DEPARTURE_TIME_OPTIONS as { value: string; label: string }[]}
                placeholder="Select time"
                {...register("time")}
              />
            </FormField>
          </div>

          <FormField label="Vehicle Type" htmlFor="route-vehicle" error={errors.vehicleId?.message} required>
            <Select
              leadingIcon={<Truck {...ICON} />}
              options={vehicleSelectOptions}
              placeholder="Select vehicle type"
              {...vehicleReg}
              onChange={onVehicleChange}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Total Capacity"
              htmlFor="route-total"
              error={errors.totalCapacity?.message}
              hint={vehicleMax !== undefined ? `Up to ${formatNumber(vehicleMax)} kg for this vehicle` : undefined}
              required
            >
              <Input inputMode="numeric" autoComplete="off" placeholder="e.g. 3000" className="tabular-nums" trailingSlot={<span className="pr-2">kg</span>} {...register("totalCapacity", { deps: ["availableCapacity"] })} />
            </FormField>
            <FormField
              label="Available Capacity"
              htmlFor="route-available"
              error={errors.availableCapacity?.message}
              hint="Space customers can book"
              required
            >
              <Input inputMode="numeric" autoComplete="off" placeholder="e.g. 2000" className="tabular-nums" trailingSlot={<span className="pr-2">kg</span>} {...register("availableCapacity")} />
            </FormField>
          </div>

          <Button type="submit" size="lg" fullWidth loading={submitting} trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />} className="mt-2">
            {submitting ? "Saving…" : "Next: Set Pricing"}
          </Button>
        </form>
      </Card>

      {hasDraft ? (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden="true" strokeWidth={1.75} />} onClick={() => setConfirmOpen(true)}>
            Discard draft
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Discard this draft?"
        description="The route details you've entered will be cleared. This can't be undone."
        confirmLabel="Discard draft"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={discard}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ───────────────────────────── Stops ─────────────────────────────

interface StopsFieldProps {
  stops: string[];
  from: string;
  to: string;
  error?: string;
  onChange(next: string[]): void;
}

function StopsField({ stops, from, to, error, onChange }: StopsFieldProps) {
  const [adding, setAdding] = useState(false);
  const addAreaRef = useRef<HTMLDivElement>(null);
  const errorId = "route-stops-error";
  const hintId = "route-stops-hint";
  const atMax = stops.length >= LIMITS.maxStops;
  const remaining = CITY_OPTIONS.filter((c) => c.value !== from && c.value !== to && !stops.includes(c.value));

  function focusAddArea() {
    requestAnimationFrame(() => addAreaRef.current?.querySelector<HTMLElement>("button, select")?.focus());
  }

  function add(cityId: string) {
    if (!cityId || stops.includes(cityId) || atMax) return;
    onChange([...stops, cityId]);
    setAdding(false);
    focusAddArea();
  }

  function remove(cityId: string) {
    onChange(stops.filter((s) => s !== cityId));
    focusAddArea();
  }

  function onSelectKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setAdding(false);
      focusAddArea();
    }
  }

  return (
    <fieldset aria-describedby={cn(hintId, error && errorId)} className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-ink">
        Intermediate Stops
        <span className="ml-1 text-caption font-medium text-ink-subtle">(optional)</span>
      </legend>
      <div className="flex flex-wrap items-center gap-2" data-testid="route-stops">
        {stops.map((id) => (
          <Chip key={id} label={cityName(id)} onRemove={() => remove(id)} className={cn(!isCityId(id) && "border-error")} />
        ))}
        <div ref={addAreaRef} className="contents">
          {adding ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Select
                aria-label="Choose a stop city"
                options={remaining}
                placeholder="Choose a city"
                value=""
                autoFocus
                onChange={(e) => add(e.target.value)}
                onKeyDown={onSelectKeyDown}
                wrapperClassName="h-11 w-56 max-w-full"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  focusAddArea();
                }}
              >
                Cancel
              </Button>
            </span>
          ) : !atMax ? (
            <Chip variant="add" label="Add Stop" onClick={() => setAdding(true)} className="pointer-coarse:min-h-11" />
          ) : null}
        </div>
      </div>
      <p id={hintId} className="mt-1.5 text-[13px] leading-5 text-ink-muted">
        {atMax ? `Maximum of ${LIMITS.maxStops} stops reached.` : `Cities you'll pass through, in order (up to ${LIMITS.maxStops}).`}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

// ───────────────────────────── Summary ─────────────────────────────

function RouteSummary({ from, to, stops }: { from: string; to: string; stops: string[] }) {
  const valid = Boolean(from && to && from !== to && isCityId(from) && isCityId(to));
  const km = valid ? draftDistanceKm({ originCityId: from, destinationCityId: to, stopCityIds: stops.filter((s) => isCityId(s) && s !== from && s !== to) }) : null;
  const path = valid ? [from, ...stops.filter((s) => isCityId(s) && s !== from && s !== to), to].map(cityName).join(" → ") : null;

  return (
    <div
      aria-live="polite"
      data-testid="route-distance"
      className="flex items-start gap-3 rounded-md border border-green-200 bg-mint-50 px-4 py-3"
    >
      <RouteIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0 text-green-700" />
      {km !== null && path ? (
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">{path}</p>
          <p className="mt-0.5 text-ink-muted">
            Route distance ≈ <span className="font-semibold text-ink tabular-nums">{formatKm(km)}</span>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, about </span>
            {formatDuration(estimateDurationMins(km))}
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Choose different From and To cities to see the route distance.</p>
      )}
    </div>
  );
}

// ───────────────────────────── Inputs ─────────────────────────────

/** Native date input with a calendar icon; shows "20 Nov, 2025" while not focused. */
function DateInput({ display, className, ...props }: InputProps & { display?: string }) {
  return (
    <div className="group relative">
      <Input
        type="date"
        leadingIcon={<Calendar {...ICON} />}
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

function FormSkeleton() {
  return (
    <Card padding="lg" aria-busy="true">
      <span className="sr-only">Loading the route form…</span>
      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-12" />
          </div>
        ))}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" rounded="full" />
          <Skeleton className="h-9 w-24" rounded="full" />
          <Skeleton className="h-9 w-28" rounded="full" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <Skeleton className="h-12" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <Skeleton className="h-13" />
      </div>
    </Card>
  );
}
