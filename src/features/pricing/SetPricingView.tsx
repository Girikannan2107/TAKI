"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CalendarDays, Clock, Info, Pencil, Route as RouteIcon, Truck, Weight } from "lucide-react";
import { Button, Card, FormField, Input, Skeleton, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import { draftDistanceKm } from "@/lib/domain/commands";
import { PRICING_PREVIEW_WEIGHT_KG } from "@/lib/domain/constants";
import { paiseToRupeesString } from "@/lib/domain/pricing";
import type { Driver, Paise, RouteDraft } from "@/lib/domain/types";
import { vehicleModelLabel } from "@/lib/domain/vehicles";
import { formatDate, formatKg, formatTime } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { ratePaiseOrNull, routePricingSchema, toRatePaise, type RoutePricingInput } from "@/lib/schemas/route-pricing.schema";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { useTakiStore } from "@/lib/store";
import { useCurrentDriver, useVehicleOptions } from "@/lib/store/selectors";
import { PricePreview } from "./PricePreview";

/** Fallbacks when neither the draft nor the driver profile has a rate (data-contract §5 defaults). */
const FALLBACK_KM_PAISE = 1200;
const FALLBACK_KG_PAISE = 50;

type ReadyDraft = RouteDraft &
  Required<Pick<RouteDraft, "originCityId" | "destinationCityId" | "travelDate" | "departureTime" | "vehicleId" | "totalCapacityKg" | "offeredCapacityKg">>;

function isDraftReady(d: RouteDraft): d is ReadyDraft {
  return Boolean(
    d.originCityId &&
      d.destinationCityId &&
      d.travelDate &&
      d.departureTime &&
      d.vehicleId &&
      d.totalCapacityKg &&
      d.offeredCapacityKg &&
      draftDistanceKm(d) !== null,
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Screen 13 — Set Pricing (`/driver/routes/new/pricing`). */
export function SetPricingView() {
  const hydrated = useHydrated();
  const draft = useTakiStore((s) => s.routeDraft);
  const driver = useCurrentDriver();
  const router = useRouter();
  const { toast } = useToast();
  /** True while publishing / after success, so the cleared draft doesn't trigger the guard. */
  const leavingRef = useRef(false);
  const ready = isDraftReady(draft);

  useEffect(() => {
    if (!hydrated || ready || leavingRef.current) return;
    leavingRef.current = true;
    toast({ title: "Add your route details first", description: "Fill in the route, then set your rates.", tone: "info" });
    router.replace(paths.driver.newRoute);
  }, [hydrated, ready, router, toast]);

  const header = (
    <PageHeader
      title="Set Pricing"
      subtitle="Enter your rates for this route"
      backHref={paths.driver.newRoute}
      backLabel="Back to route details"
    />
  );

  if (!hydrated || !ready) {
    return (
      <div className="mx-auto w-full max-w-[1040px]">
        {header}
        <PricingSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1040px]">
      {header}
      <PricingForm
        draft={draft}
        driver={driver}
        onLeaving={(v) => {
          leavingRef.current = v;
        }}
      />
    </div>
  );
}

function PricingForm({ draft, driver, onLeaving }: { draft: ReadyDraft; driver: Driver | null; onLeaving(v: boolean): void }) {
  const router = useRouter();
  const updateRouteDraft = useTakiStore((s) => s.updateRouteDraft);
  const vehicleOptions = useVehicleOptions();
  const [publishing, setPublishing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RoutePricingInput>({
    resolver: zodResolver(routePricingSchema),
    mode: "onChange",
    defaultValues: {
      ratePerKm: paiseToRupeesString(draft.ratePerKmPaise ?? driver?.defaultRatePerKmPaise ?? FALLBACK_KM_PAISE),
      ratePerKg: paiseToRupeesString(draft.ratePerKgPaise ?? driver?.defaultRatePerKgPaise ?? FALLBACK_KG_PAISE),
    },
  });

  const [kmText = "", kgText = ""] = useWatch({ control, name: ["ratePerKm", "ratePerKg"] });
  const kmPaise = ratePaiseOrNull("ratePerKm", kmText);
  const kgPaise = ratePaiseOrNull("ratePerKg", kgText);
  const previewKm = useDebounced<Paise | null>(kmPaise, 150);
  const previewKg = useDebounced<Paise | null>(kgPaise, 150);
  const valid = kmPaise !== null && kgPaise !== null;

  // Keep valid rates on the draft so "Back" to the route form and returning keeps them.
  useEffect(() => {
    if (submittingRef.current || kmPaise === null || kgPaise === null) return;
    const current = useTakiStore.getState().routeDraft;
    if (current.ratePerKmPaise === kmPaise && current.ratePerKgPaise === kgPaise) return;
    updateRouteDraft({ ratePerKmPaise: kmPaise, ratePerKgPaise: kgPaise });
  }, [kmPaise, kgPaise, updateRouteDraft]);

  const distanceKm = draftDistanceKm(draft) ?? 0;
  const pathIds = [draft.originCityId, ...(draft.stopCityIds ?? []), draft.destinationCityId];
  const vehicleLabel =
    vehicleOptions.find((o) => o.value === draft.vehicleId)?.label ??
    (draft.vehicleId.startsWith("new:") ? vehicleModelLabel(draft.vehicleId.slice(4)) : "Selected vehicle");

  async function publish(values: RoutePricingInput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    onLeaving(true);
    setPublishing(true);
    setServerError(null);
    try {
      const route = await marketplace.publishRoute({ ...draft, ...toRatePaise(values) });
      router.replace(paths.driver.routes({ published: route.id }));
    } catch (e) {
      submittingRef.current = false;
      onLeaving(false);
      setPublishing(false);
      setServerError(errorMessage(e, "We couldn't publish this route. Please try again."));
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(publish)(e)} noValidate className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5">
        <Card as="section" aria-labelledby="draft-summary-title" padding="sm" className="sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="draft-summary-title" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Your route
            </h2>
            <Link
              href={paths.driver.newRoute}
              className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
            >
              <Pencil aria-hidden="true" strokeWidth={1.75} className="size-4" />
              Edit route
            </Link>
          </div>
          <p className="mt-1 flex items-start gap-2 font-heading text-base font-bold text-ink sm:text-lg" data-testid="draft-path">
            <RouteIcon aria-hidden="true" strokeWidth={1.75} className="mt-1 size-[18px] shrink-0 text-green-500" />
            <span className="min-w-0 break-words">{pathIds.map(cityName).join(" → ")}</span>
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-sm min-[420px]:grid-cols-2">
            <SummaryItem icon={<CalendarDays />} label="Date" value={formatDate(draft.travelDate)} />
            <SummaryItem icon={<Clock />} label="Departure" value={formatTime(draft.departureTime)} />
            <SummaryItem
              icon={<Truck />}
              label="Vehicle"
              value={vehicleLabel.split(" · ").map((part, i) => (
                <span key={i} className={i > 0 ? "whitespace-nowrap" : undefined}>
                  {i > 0 ? " · " : null}
                  {part}
                </span>
              ))}
            />
            <SummaryItem
              icon={<Weight />}
              label="Capacity"
              value={`${formatKg(draft.offeredCapacityKg)} of ${formatKg(draft.totalCapacityKg)}`}
            />
          </dl>
        </Card>

        <Card as="section" aria-labelledby="rates-title" padding="sm" className="sm:p-5">
          <h2 id="rates-title" className="sr-only">
            Your rates
          </h2>
          <div className="flex flex-col gap-5">
            <FormField label="Per Kilometre Rate" htmlFor="rate-per-km" error={errors.ratePerKm?.message} required>
              <Input
                inputMode="decimal"
                autoComplete="off"
                prefix="₹"
                trailingSlot={<span aria-hidden="true">/ km</span>}
                aria-describedby="rate-per-km-unit"
                {...register("ratePerKm")}
              />
            </FormField>
            <span id="rate-per-km-unit" className="sr-only">
              rupees per kilometre
            </span>
            <FormField label="Per Kilogram Rate" htmlFor="rate-per-kg" error={errors.ratePerKg?.message} required>
              <Input
                inputMode="decimal"
                autoComplete="off"
                prefix="₹"
                trailingSlot={<span aria-hidden="true">/ kg</span>}
                aria-describedby="rate-per-kg-unit"
                {...register("ratePerKg")}
              />
            </FormField>
            <span id="rate-per-kg-unit" className="sr-only">
              rupees per kilogram
            </span>
          </div>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
        <PricePreview
          distanceKm={distanceKm}
          weightKg={PRICING_PREVIEW_WEIGHT_KG}
          ratePerKmPaise={previewKm}
          ratePerKgPaise={previewKg}
        />
        <p className="flex items-start gap-2.5 px-1 text-sm text-ink-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-[18px] shrink-0 text-green-700" />
          <span>The customer will see a final price with a small TAKI service fee added.</span>
        </p>

        {serverError ? (
          <div role="alert" className="rounded-md border border-error/30 bg-danger-100 px-4 py-3 text-sm text-error">
            <p className="font-semibold">Route not published</p>
            <p className="mt-0.5">{serverError}</p>
            <Link
              href={paths.driver.newRoute}
              className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              Edit route details
            </Link>
          </div>
        ) : null}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={publishing}
          disabled={!valid}
          trailingIcon={publishing ? undefined : <ArrowRight />}
        >
          {publishing ? "Publishing…" : "Publish Route"}
        </Button>
      </div>
    </form>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
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
      <span className="sr-only">Loading route details…</span>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-52 rounded-lg" />
        <Skeleton className="h-13 rounded-md" />
      </div>
    </div>
  );
}
