"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Save, Truck, UserRound } from "lucide-react";
import { Button, Card, ChoiceChips, EmptyState, FormField, Input, Select, Skeleton, Stepper, Textarea, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyTripDTO, TripFormOptionsDTO, TripInput } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { GOODS_CATEGORIES, SPECIAL_HANDLING, type GoodsCategory, type SpecialHandling } from "@/lib/domain/model";
import { capacityIssues, checkpointIssues, goodsIssues, isoToIstLocal, istLocalToIso } from "@/lib/domain/trip-rules";
import { formatNumber } from "@/lib/format";
import { CheckpointEditor, newRow, type CheckpointRow } from "@/features/agency/CheckpointEditor";
import { fieldErrorsOf, when } from "@/features/agency/format";
import { GOODS_LABEL, GOODS_OPTIONS, HANDLING_OPTIONS } from "@/features/agency/labels";
import { LoadError, VerificationBanner } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";

const STEPS = ["Trip details", "Pricing"] as const;

interface FormState {
  vehicleId: string;
  driverId: string;
  rows: CheckpointRow[];
  maxCapacityKg: string;
  offeredKg: string;
  acceptedGoods: GoodsCategory[];
  handlingSupported: SpecialHandling[];
  maxPackageKg: string;
  goodsNotes: string;
}

function emptyForm(): FormState {
  return {
    vehicleId: "",
    driverId: "",
    rows: [newRow(), newRow()],
    maxCapacityKg: "",
    offeredKg: "",
    acceptedGoods: [],
    handlingSupported: [],
    maxPackageKg: "",
    goodsNotes: "",
  };
}

function formFromTrip(t: AgencyTripDTO): FormState {
  return {
    vehicleId: t.vehicle.id,
    driverId: t.driver.id,
    rows: t.checkpoints.map((c) => newRow({ placeId: c.placeId, arrival: isoToIstLocal(c.expectedArrivalAt), departure: isoToIstLocal(c.expectedDepartureAt) })),
    maxCapacityKg: String(t.capacity.vehicleMaxKg),
    offeredKg: String(t.capacity.offeredKg),
    acceptedGoods: t.goods.accepted,
    handlingSupported: t.goods.handlingSupported,
    maxPackageKg: t.goods.maxPackageKg ? String(t.goods.maxPackageKg) : "",
    goodsNotes: t.goods.notes ?? "",
  };
}

const kgOf = (s: string): number | null => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? Math.round(n) : null;
};

function toBody(f: FormState): Omit<TripInput, "publish"> {
  const last = f.rows.length - 1;
  return {
    vehicleId: f.vehicleId,
    driverId: f.driverId,
    maxCapacityKg: kgOf(f.maxCapacityKg),
    offeredKg: kgOf(f.offeredKg) ?? 0,
    checkpoints: f.rows.map((r, i) => ({
      placeId: r.placeId,
      expectedArrivalAt: i === 0 ? null : istLocalToIso(r.arrival),
      expectedDepartureAt: i === last ? null : istLocalToIso(r.departure),
    })),
    acceptedGoods: f.acceptedGoods,
    handlingSupported: f.handlingSupported,
    maxPackageKg: kgOf(f.maxPackageKg),
    goodsNotes: f.goodsNotes.trim() || null,
  };
}

/** Client-side mirror of the server rules (the server re-validates everything). */
function validate(f: FormState, options: TripFormOptionsDTO | null): Record<string, string> {
  const errors: Record<string, string> = {};
  const put = (path: string, message: string) => {
    if (!(path in errors)) errors[path] = message;
  };
  if (!f.vehicleId) put("vehicleId", "Choose a vehicle");
  if (!f.driverId) put("driverId", "Choose a driver");
  const body = toBody(f);
  for (const i of checkpointIssues(body.checkpoints)) put(i.path, i.message);
  const vehicle = options?.vehicles.find((v) => v.id === f.vehicleId);
  if (kgOf(f.offeredKg) === null) put("offeredKg", "Enter the capacity customers can book");
  else if (vehicle) for (const i of capacityIssues({ offeredKg: body.offeredKg, maxCapacityKg: body.maxCapacityKg, vehiclePayloadKg: vehicle.maxPayloadKg })) put(i.path, i.message);
  if (vehicle) for (const i of goodsIssues({ acceptedGoods: f.acceptedGoods, handlingSupported: f.handlingSupported }, vehicle)) put(i.path, i.message);
  else if (!f.acceptedGoods.length) put("acceptedGoods", "Choose at least one goods category.");
  return errors;
}

export interface AddRouteViewProps {
  /** `?draft=<tripId>`: continue editing a saved draft. */
  draft?: string;
}

/** Add Trip, step 1 (`/agency/trips/new?draft=`, P3 §4.4): vehicle & driver, route & checkpoints, capacity & goods. */
export function AddRouteView({ draft }: AddRouteViewProps = {}) {
  const existing = useApi<AgencyTripDTO | null>(`draft:${draft ?? "new"}`, () => (draft ? agencyApi.trip(draft) : Promise.resolve(null)));

  if (existing.state.status === "loading") return <AddTripSkeleton />;
  if (existing.state.status === "error") {
    return (
      <>
        <Header />
        <LoadError message={existing.state.message} onRetry={existing.reload} title="We couldn't load this draft" />
      </>
    );
  }
  const trip = existing.state.data;
  if (trip && trip.status !== "draft") {
    return (
      <>
        <Header />
        <EmptyState title="This trip is already published" description="Open it to manage bookings, reassign the driver or cancel it." action={{ label: "Open trip", href: paths.agency.trip(trip.id) }} />
      </>
    );
  }
  return <AddTripForm key={trip?.id ?? "new"} trip={trip} />;
}

function Header() {
  return <PageHeader title="Add Trip" backHref={paths.agency.trips()} backLabel="Back to trips" subtitle="Publish the trip you're already making and let customers book your spare space." />;
}

function AddTripForm({ trip }: { trip: AgencyTripDTO | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => (trip ? formFromTrip(trip) : emptyForm()));
  const [tripId, setTripId] = useState<string | null>(trip?.id ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState<null | "draft" | "next">(null);

  const departureAt = istLocalToIso(form.rows[0]?.departure);
  const arrivalAt = istLocalToIso(form.rows[form.rows.length - 1]?.arrival);
  const optKey = `opts:${departureAt ?? ""}:${arrivalAt ?? ""}:${tripId ?? ""}`;
  const opts = useApi<TripFormOptionsDTO>(optKey, () => agencyApi.tripFormOptions({ departureAt, arrivalAt, excludeTripId: tripId }));
  const [lastOptions, setLastOptions] = useState<TripFormOptionsDTO | null>(null);
  const options = opts.state.status === "ready" ? opts.state.data : lastOptions;
  if (opts.state.status === "ready" && opts.state.data !== lastOptions) setLastOptions(opts.state.data);

  const vehicle = options?.vehicles.find((v) => v.id === form.vehicleId) ?? null;
  const shownErrors = submitted ? { ...validate(form, options), ...errors } : errors;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!Object.keys(e).length) return e;
      const next = { ...e };
      const prefix = key === "rows" ? "checkpoints" : String(key);
      for (const k of Object.keys(next)) if (k === prefix || k.startsWith(`${prefix}.`)) delete next[k];
      return next;
    });
  }

  function chooseVehicle(id: string) {
    const v = options?.vehicles.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      vehicleId: id,
      maxCapacityKg: v ? String(v.maxPayloadKg) : f.maxCapacityKg,
      offeredKg: v && (!f.offeredKg || (kgOf(f.offeredKg) ?? 0) > v.maxPayloadKg) ? String(v.maxPayloadKg) : f.offeredKg,
      acceptedGoods: v ? (f.acceptedGoods.length ? f.acceptedGoods.filter((g) => v.acceptedGoods.includes(g)) : v.acceptedGoods) : f.acceptedGoods,
      handlingSupported: v ? f.handlingSupported.filter((h) => v.handlingSupported.includes(h)) : f.handlingSupported,
    }));
    setErrors({});
  }

  async function save(intent: "draft" | "next") {
    setSubmitted(true);
    const local = validate(form, options);
    // A draft may be incomplete only in ways the server still accepts; the server is the judge.
    if (Object.keys(local).length) {
      setErrors({});
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setSaving(intent);
    try {
      const body = toBody(form);
      const saved = tripId ? await agencyApi.updateTrip(tripId, body) : await agencyApi.createTrip({ ...body, publish: false });
      setTripId(saved.id);
      setErrors({});
      if (intent === "next") {
        router.push(paths.agency.tripPricing(saved.id));
        return;
      }
      toast({ title: "Draft saved", description: saved.routeLabel, tone: "success" });
      router.replace(paths.agency.newTrip(saved.id), { scroll: false });
    } catch (e) {
      const fields = fieldErrorsOf(e);
      setErrors(fields);
      toast({ title: "Couldn't save the trip", description: errorMessage(e), tone: "error" });
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
    } finally {
      setSaving(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save("next");
  }

  const restricted = vehicle ? GOODS_CATEGORIES.filter((g) => !form.acceptedGoods.includes(g)) : [];
  const vehicleOptions = (options?.vehicles ?? []).map((v) => ({
    value: v.id,
    label: v.busy
      ? `${v.label} (on trip ${when(v.busy.from)} – ${when(v.busy.to)})`
      : v.status === "inactive"
        ? `${v.label} (inactive)`
        : `${v.label} · up to ${formatNumber(v.maxPayloadKg)} kg`,
    disabled: (!!v.busy || v.status === "inactive") && v.id !== form.vehicleId,
  }));
  const driverOptions = (options?.drivers ?? []).map((d) => ({
    value: d.id,
    label: d.busy ? `${d.fullName} (on trip ${when(d.busy.from)} – ${when(d.busy.to)})` : d.availability === "unavailable" ? `${d.fullName} (unavailable)` : d.fullName,
    disabled: (!!d.busy || d.availability === "unavailable") && d.id !== form.driverId,
  }));
  const noFleet = options && (options.vehicles.length === 0 || options.drivers.length === 0);

  return (
    <>
      <Header />
      <Stepper steps={STEPS} current={0} className="mb-5" />
      {options ? <VerificationBanner status={options.verification} className="mb-5" /> : null}
      {noFleet ? (
        <Card tone="muted" padding="sm" className="mb-5" role="note">
          <p className="text-sm text-ink">
            {options.vehicles.length === 0 ? "Add a vehicle" : "Add and approve a driver"} before creating a trip.{" "}
            <Link className="font-semibold text-green-700 underline-offset-4 hover:underline" href={options.vehicles.length === 0 ? paths.agency.newVehicle : paths.agency.drivers()}>
              {options.vehicles.length === 0 ? "Add vehicle" : "Manage drivers"}
            </Link>
          </p>
        </Card>
      ) : null}
      {opts.state.status === "error" && !options ? <LoadError message={opts.state.message} onRetry={opts.reload} className="mb-5" /> : null}

      <form noValidate aria-label="Trip details" onSubmit={onSubmit} className="mx-auto flex w-full max-w-[860px] flex-col gap-5 pb-24 lg:pb-0">
        <Card as="section" aria-labelledby="vd-title" padding="lg">
          <h2 id="vd-title" className="type-h3 mb-4 text-ink">
            1. Vehicle & driver
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormField label="Vehicle" htmlFor="trip-vehicle" error={shownErrors.vehicleId} required hint={departureAt && arrivalAt ? "Vehicles busy in this window are disabled." : "Set the departure and arrival to see who's free."}>
              <Select
                id="trip-vehicle"
                leadingIcon={<Truck strokeWidth={1.75} aria-hidden="true" />}
                options={vehicleOptions}
                placeholder={options ? "Choose a vehicle" : "Loading vehicles…"}
                value={form.vehicleId}
                invalid={!!shownErrors.vehicleId}
                disabled={!options}
                onChange={(e) => chooseVehicle(e.target.value)}
              />
            </FormField>
            <FormField label="Driver" htmlFor="trip-driver" error={shownErrors.driverId} required hint="Only approved drivers are listed.">
              <Select
                id="trip-driver"
                leadingIcon={<UserRound strokeWidth={1.75} aria-hidden="true" />}
                options={driverOptions}
                placeholder={options ? "Choose a driver" : "Loading drivers…"}
                value={form.driverId}
                invalid={!!shownErrors.driverId}
                disabled={!options}
                onChange={(e) => set("driverId", e.target.value)}
              />
            </FormField>
          </div>
        </Card>

        <Card as="section" aria-labelledby="route-title" padding="lg">
          <h2 id="route-title" className="type-h3 mb-4 text-ink">
            2. Route & checkpoints
          </h2>
          <CheckpointEditor rows={form.rows} onChange={(rows) => set("rows", rows)} errors={shownErrors} kms={trip?.checkpoints.map((c) => c.kmFromOrigin)} />
        </Card>

        <Card as="section" aria-labelledby="cap-title" padding="lg">
          <h2 id="cap-title" className="type-h3 mb-4 text-ink">
            3. Capacity & goods
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormField
              label="Max capacity"
              htmlFor="trip-max"
              error={shownErrors.maxCapacityKg}
              hint={vehicle ? `Up to ${formatNumber(vehicle.maxPayloadKg)} kg for this vehicle` : "Prefilled from the vehicle"}
              required
            >
              <Input id="trip-max" inputMode="numeric" className="tabular-nums" trailingSlot={<span className="pr-2">kg</span>} value={form.maxCapacityKg} invalid={!!shownErrors.maxCapacityKg} onChange={(e) => set("maxCapacityKg", e.target.value)} />
            </FormField>
            <FormField label="Capacity available for booking" htmlFor="trip-offered" error={shownErrors.offeredKg} hint="Space customers can book (≤ max capacity)" required>
              <Input id="trip-offered" inputMode="numeric" className="tabular-nums" trailingSlot={<span className="pr-2">kg</span>} value={form.offeredKg} invalid={!!shownErrors.offeredKg} onChange={(e) => set("offeredKg", e.target.value)} />
            </FormField>
          </div>
          <ChoiceChips
            multiple
            className="mt-5"
            legend="Accepted goods"
            required
            options={vehicle ? GOODS_OPTIONS.filter((o) => vehicle.acceptedGoods.includes(o.value)) : GOODS_OPTIONS}
            value={form.acceptedGoods}
            onChange={(v) => set("acceptedGoods", v as GoodsCategory[])}
            error={shownErrors.acceptedGoods}
            hint={vehicle ? "Goods this vehicle can't carry are not offered." : undefined}
          />
          {restricted.length ? (
            <p className="mt-3 text-sm text-ink-muted">
              <span className="font-medium text-ink">Restricted on this trip:</span> {restricted.map((g) => GOODS_LABEL[g]).join(", ")}
            </p>
          ) : null}
          <ChoiceChips
            multiple
            className="mt-5"
            legend="Special handling you can offer"
            options={vehicle ? HANDLING_OPTIONS.filter((o) => vehicle.handlingSupported.includes(o.value)) : HANDLING_OPTIONS.filter((o) => SPECIAL_HANDLING.includes(o.value))}
            value={form.handlingSupported}
            onChange={(v) => set("handlingSupported", v as SpecialHandling[])}
            error={shownErrors.handlingSupported}
          />
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormField label="Max weight per package" htmlFor="trip-maxpkg" optionalLabel error={shownErrors.maxPackageKg}>
              <Input id="trip-maxpkg" inputMode="numeric" className="tabular-nums" trailingSlot={<span className="pr-2">kg</span>} value={form.maxPackageKg} onChange={(e) => set("maxPackageKg", e.target.value)} />
            </FormField>
          </div>
          <FormField label="Other restrictions" htmlFor="trip-notes" optionalLabel className="mt-5" error={shownErrors.goodsNotes}>
            <Textarea id="trip-notes" maxLength={300} showCount value={form.goodsNotes} onChange={(e) => set("goodsNotes", e.target.value)} placeholder="e.g. No liquids, packages must be shrink-wrapped" />
          </FormField>
        </Card>

        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-border bg-surface p-3 lg:static lg:justify-end lg:border-0 lg:bg-transparent lg:p-0">
          <Button type="button" variant="outline" className="flex-1 lg:flex-none" loading={saving === "draft"} disabled={!!saving} leadingIcon={<Save aria-hidden="true" strokeWidth={2} />} onClick={() => void save("draft")}>
            Save draft
          </Button>
          <Button type="submit" className="flex-1 lg:flex-none" loading={saving === "next"} disabled={!!saving} trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />}>
            Next: Pricing
          </Button>
        </div>
      </form>
    </>
  );
}

function AddTripSkeleton() {
  return (
    <>
      <Header />
      <div aria-busy="true" className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </>
  );
}
