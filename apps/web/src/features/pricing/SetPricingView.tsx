"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, Info, Pencil, Route as RouteIcon, Save, Send, Truck, UserRound, Weight } from "lucide-react";
import { Button, Card, EmptyState, FormField, Input, Skeleton, Stepper, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyTripDTO } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { PRICING_PREVIEW_WEIGHT_KG } from "@/lib/domain/constants";
import { paiseToRupeesString, rupeesToPaise } from "@/lib/domain/pricing";
import { formatKg, formatKm } from "@/lib/format";
import { fieldErrorsOf, when } from "@/features/agency/format";
import { LoadError } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";
import { AdditionalChargesEditor, newChargeRow, parseCharges, type ChargeRow } from "./AdditionalChargesEditor";
import { PricePreview } from "./PricePreview";

const STEPS = ["Trip details", "Pricing"] as const;

/** Rupee string → paise within [min, max], or an error message. */
function parseRate(v: string, min: number, max: number, label: string): { paise: number | null; error?: string } {
  if (!v.trim()) return { paise: null, error: `Enter your ${label} rate` };
  const p = rupeesToPaise(v);
  if (!Number.isFinite(p)) return { paise: null, error: "Enter an amount like 12 or 0.50" };
  if (p < min) return { paise: null, error: `At least ₹${paiseToRupeesString(min)}/${label === "per-km" ? "km" : "kg"}` };
  if (p > max) return { paise: null, error: `At most ₹${paiseToRupeesString(max)}/${label === "per-km" ? "km" : "kg"}` };
  return { paise: p };
}

export interface SetPricingViewProps {
  /** `?draft=<tripId>` from step 1. */
  draft?: string;
}

/** Add Trip, step 2 (`/agency/trips/new/pricing?draft=`): per-km and per-kg rates, additional charges (M4), preview, save draft or publish. */
export function SetPricingView({ draft }: SetPricingViewProps = {}) {
  const { state, reload } = useApi<AgencyTripDTO | null>(`pricing:${draft ?? ""}`, () => (draft ? agencyApi.trip(draft) : Promise.resolve(null)));
  const header = <PageHeader title="Set Pricing" subtitle="Enter your rates for this trip" backHref={paths.agency.newTrip(draft)} backLabel="Back to trip details" />;

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[1040px]">
        {header}
        <PricingSkeleton />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-[1040px]">
        {header}
        <LoadError message={state.message} onRetry={reload} title="We couldn't load this trip" />
      </div>
    );
  }
  const trip = state.data;
  if (!trip || trip.status !== "draft") {
    return (
      <div className="mx-auto w-full max-w-[1040px]">
        {header}
        <EmptyState
          icon={<RouteIcon strokeWidth={1.75} />}
          title={trip ? "This trip is already published" : "Add your trip details first"}
          description={trip ? "Open the trip to manage it." : "Fill in the vehicle, route and capacity, then set your rates."}
          action={trip ? { label: "Open trip", href: paths.agency.trip(trip.id) } : { label: "Add Trip", href: paths.agency.newTrip() }}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1040px]">
      {header}
      <Stepper steps={STEPS} current={1} className="mb-5" />
      <PricingForm trip={trip} />
    </div>
  );
}

function PricingForm({ trip }: { trip: AgencyTripDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const [perKm, setPerKm] = useState(paiseToRupeesString(trip.rates.perKmPaise));
  const [perKg, setPerKg] = useState(paiseToRupeesString(trip.rates.perKgPaise));
  const [charges, setCharges] = useState<ChargeRow[]>(() => (trip.rates.additionalCharges ?? []).map((c) => newChargeRow(c)));
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const km = parseRate(perKm, 100, 10_000, "per-km");
  const kg = parseRate(perKg, 0, 2_000, "per-kg");
  const parsedCharges = parseCharges(charges);
  const errors = { ratePerKmPaise: touched ? km.error : undefined, ratePerKgPaise: touched ? kg.error : undefined, ...serverErrors };
  // Row errors: local validation after the first submit, plus the server's `additionalCharges.{i}.{field}`.
  const chargeErrors: Record<string, string> = {
    ...(touched ? parsedCharges.errors : {}),
    ...Object.fromEntries(
      Object.entries(serverErrors)
        .filter(([k]) => k.startsWith("additionalCharges."))
        .map(([k, v]) => [k.replace(/^additionalCharges\./, "").replace("amountRupees", "amount"), v]),
    ),
  };
  const blockers = trip.publishBlockers;

  async function save(intent: "draft" | "publish") {
    setTouched(true);
    if (km.paise === null || kg.paise === null || !parsedCharges.charges) return;
    setSaving(intent);
    setServerError(null);
    try {
      await agencyApi.updateTrip(trip.id, { ratePerKmPaise: km.paise, ratePerKgPaise: kg.paise, additionalCharges: parsedCharges.charges });
      if (intent === "draft") {
        toast({ title: "Draft saved", description: trip.routeLabel, tone: "success" });
        router.push(paths.agency.trips({ tab: "drafts" }));
        return;
      }
      const published = await agencyApi.publishTrip(trip.id);
      router.push(paths.agency.trips({ tab: "upcoming", published: published.id }));
    } catch (e) {
      const fields = fieldErrorsOf(e);
      setServerErrors(fields);
      setServerError(errorMessage(e));
      setSaving(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save("publish");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5">
        <Card as="section" aria-labelledby="draft-summary-title" padding="sm" className="sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="draft-summary-title" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Trip summary
            </h2>
            <Link
              href={paths.agency.newTrip(trip.id)}
              className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
            >
              <Pencil aria-hidden="true" strokeWidth={1.75} className="size-4" />
              Edit<span className="sr-only"> trip details</span>
            </Link>
          </div>
          <p className="mt-1 flex items-start gap-2 font-heading text-base font-bold text-ink sm:text-lg" data-testid="draft-path">
            <RouteIcon aria-hidden="true" strokeWidth={1.75} className="mt-1 size-[18px] shrink-0 text-green-500" />
            <span className="min-w-0 break-words">{trip.stops.join(" → ")}</span>
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-sm min-[420px]:grid-cols-2">
            <SummaryItem icon={<CalendarDays />} label="Departs" value={when(trip.departureAt)} />
            <SummaryItem icon={<CalendarDays />} label="Arrives" value={when(trip.arrivalAt)} />
            <SummaryItem icon={<Truck />} label="Vehicle" value={`${trip.vehicle.makeModel} · ${trip.vehicle.registrationNumber}`} />
            <SummaryItem icon={<UserRound />} label="Driver" value={trip.driver.fullName} />
            <SummaryItem icon={<Weight />} label="For booking" value={formatKg(trip.capacity.offeredKg)} />
            <SummaryItem icon={<RouteIcon />} label="Distance" value={`≈ ${formatKm(trip.distanceKm)}`} />
          </dl>
        </Card>

        <Card as="section" aria-labelledby="rates-title" padding="sm" className="sm:p-5">
          <h2 id="rates-title" className="sr-only">
            Your rates
          </h2>
          <div className="flex flex-col gap-5">
            <FormField label="Rate per km" htmlFor="rate-per-km" error={errors.ratePerKmPaise} required hint="₹1 – ₹100 per km">
              <Input
                id="rate-per-km"
                inputMode="decimal"
                className="tabular-nums"
                prefix="₹"
                trailingSlot={<span className="pr-2 text-ink-muted">/km</span>}
                value={perKm}
                invalid={!!errors.ratePerKmPaise}
                onChange={(e) => {
                  setPerKm(e.target.value);
                  setServerErrors({});
                }}
              />
            </FormField>
            <FormField label="Rate per kg" htmlFor="rate-per-kg" error={errors.ratePerKgPaise} required hint="₹0 – ₹20 per kg">
              <Input
                id="rate-per-kg"
                inputMode="decimal"
                className="tabular-nums"
                prefix="₹"
                trailingSlot={<span className="pr-2 text-ink-muted">/kg</span>}
                value={perKg}
                invalid={!!errors.ratePerKgPaise}
                onChange={(e) => {
                  setPerKg(e.target.value);
                  setServerErrors({});
                }}
              />
            </FormField>
          </div>
        </Card>

        <Card as="section" aria-label="Additional charges" padding="sm" className="sm:p-5">
          <AdditionalChargesEditor
            rows={charges}
            errors={chargeErrors}
            onChange={(rows) => {
              setCharges(rows);
              setServerErrors({});
            }}
          />
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
        <PricePreview
          distanceKm={trip.distanceKm}
          weightKg={PRICING_PREVIEW_WEIGHT_KG}
          ratePerKmPaise={km.paise}
          ratePerKgPaise={kg.paise}
          additionalCharges={parsedCharges.charges ?? undefined}
        />
        <p className="flex items-start gap-2.5 px-1 text-sm text-ink-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-[18px] shrink-0 text-green-700" />
          Customers also pay TAKI&apos;s service fee. Your earnings are the distance and weight charges plus the additional charges that apply.
        </p>
        {blockers.length ? (
          <div role="note" className="rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-ink" data-testid="publish-blockers">
            <p className="font-semibold">Publishing is blocked</p>
            <ul className="mt-1 list-disc pl-5 text-ink-muted">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {serverError ? (
          <div role="alert" className="rounded-md border border-error/30 bg-danger-100 px-4 py-3 text-sm text-error">
            <p className="font-semibold">Trip not published</p>
            <p className="mt-0.5">{serverError}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <Button type="submit" size="lg" fullWidth loading={saving === "publish"} disabled={!!saving || blockers.length > 0} leadingIcon={<Send aria-hidden="true" strokeWidth={2} />} aria-describedby={blockers.length ? "publish-blockers-note" : undefined}>
            Publish trip
          </Button>
          <Button type="button" variant="outline" size="lg" fullWidth loading={saving === "draft"} disabled={!!saving} leadingIcon={<Save aria-hidden="true" strokeWidth={2} />} onClick={() => void save("draft")}>
            Save draft
          </Button>
          {blockers.length ? (
            <span id="publish-blockers-note" className="sr-only">
              {blockers.join(" ")}
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span aria-hidden="true" className="mt-0.5 flex shrink-0 text-green-500 [&_svg]:size-4 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      <dt className="text-ink-muted">{label}:</dt>
      <dd className="min-w-0 break-words font-medium text-ink">{value}</dd>
    </div>
  );
}

function PricingSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-6">
      <span className="sr-only">Loading trip details…</span>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-52 rounded-lg" />
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
