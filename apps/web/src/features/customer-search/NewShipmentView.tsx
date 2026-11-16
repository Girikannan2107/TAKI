"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Crosshair, MapPin, PackageSearch, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, Checkbox, ChoiceChips, FormField, Input, PhoneInput, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { PlaceAutocompleteInput, type PlaceSelection } from "@/components/maps/PlaceAutocompleteInput";
import { mapsApi } from "@/lib/api/client/auth";
import { customerApi } from "@/lib/api/client/customer";
import { CreateShipmentRequestSchema, type AddressRequest, type CreateShipmentRequest, type ShipmentDTO } from "@/lib/api/contracts/customer";
import type { PlaceDTO } from "@/lib/api/contracts/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import type { GoodsCategory, IsoDate, PackageType, SpecialHandling, StateCode } from "@/lib/domain/model";
import { formatDate } from "@/lib/format";
import {
  WEIGHT_UNITS,
  dateProblem,
  kgToUnitString,
  maxPickupDate,
  parseSearchPrefill,
  weightProblem,
  weightToKg,
  type WeightUnit,
} from "@/lib/schemas/shipment-search.schema";
import { useProfile } from "@/features/account";
import { GOODS_OPTIONS, HANDLING_OPTIONS, PACKAGE_OPTIONS, STATE_OPTIONS, isStateCode } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { useApi } from "@/features/customer-shipment/use-api";
import { vehicleDetailsHref, vehiclesHref } from "@/features/customer-shipment/urls";

const PAGE = "mx-auto w-full max-w-[1180px]";

/**
 * One address (v3, contract §1 AddressInput). `autocomplete`: a place picked from Google Places (or found by
 * the server, E23); `current_location`: browser geolocation, reverse-geocoded by the server (E24);
 * `manual`: typed text the server geocodes on save. The fields stay editable in every mode.
 */
interface AddressForm {
  mode: "autocomplete" | "manual" | "current_location";
  search: PlaceSelection | null;
  line1: string;
  landmark: string;
  /** District / town the server resolved (display only). */
  area: string;
  state: string;
  pincode: string;
  location?: { lat: number; lng: number };
}

interface Values {
  source: AddressForm;
  destination: AddressForm;
  receiverName: string;
  receiverPhone: string;
  weight: string;
  unit: WeightUnit;
  packageType: PackageType | "";
  goodsCategory: GoodsCategory;
  description: string;
  pieces: string;
  specialHandling: SpecialHandling[];
  date: string;
  prohibited: boolean;
}

type Errors = Partial<Record<string, string>>;

const emptyAddress = (prefill?: { placeId?: string; label?: string }): AddressForm => ({
  mode: "autocomplete",
  search: prefill?.label ? { placeId: prefill.placeId ?? "", label: prefill.label } : null,
  line1: "",
  landmark: "",
  area: "",
  state: "",
  pincode: "",
});

/** Fields a resolved place prefills (all stay editable). */
function prefillFrom(place: PlaceDTO): Partial<AddressForm> {
  const state = isStateCode(place.state) ? place.state : "";
  return {
    line1: (place.formattedAddress || place.name).replace(/, India$/, "").slice(0, 120),
    area: [place.district ?? place.locality, place.stateName].filter(Boolean).join(", "),
    state,
    pincode: place.pincode ?? "",
  };
}

/** 10-digit Indian mobile from E.164 (+91…) for PhoneInput. */
const localPhone = (e164: string) => e164.replace(/^\+91/, "");

/** Form field id for a server / zod issue path ("source.line1", "package.weightKg", …). */
const FIELD_OF: Record<string, string> = {
  "receiver.name": "receiverName",
  "receiver.phone": "receiverPhone",
  "package.weightKg": "weight",
  "package.goodsCategory": "goodsCategory",
  "package.packageType": "packageType",
  "package.description": "description",
  "package.pieces": "pieces",
  "package.specialHandling": "specialHandling",
  "package.prohibitedItemsDeclaration": "prohibited",
  shippingDate: "date",
};
const fieldOf = (path: string) => FIELD_OF[path] ?? path;

/** DOM order of fields, for focusing the first invalid one. */
const FIELD_ORDER = [
  "source.search",
  "source.line1",
  "source.state",
  "source.pincode",
  "destination.search",
  "destination.line1",
  "destination.state",
  "destination.pincode",
  "receiverName",
  "receiverPhone",
  "weight",
  "packageType",
  "goodsCategory",
  "description",
  "pieces",
  "date",
  "prohibited",
];
const domId = (field: string) => `ns-${field.replace(".", "-")}`;

function toAddress(a: AddressForm): AddressRequest {
  const mode = a.mode === "autocomplete" && !a.search?.placeId ? "manual" : a.mode;
  return {
    line1: a.line1.trim(),
    ...(a.landmark.trim() ? { landmark: a.landmark.trim() } : {}),
    state: (a.state || "TN") as StateCode,
    pincode: a.pincode.trim(),
    source: mode,
    ...(mode === "autocomplete" ? { placeId: a.search!.placeId } : {}),
    ...(mode === "current_location" && a.location ? { location: a.location } : {}),
  };
}

function fromAddress(a: ShipmentDTO["source"]): AddressForm {
  const place = a.place;
  return {
    mode: place ? "autocomplete" : "manual",
    search: place ? { placeId: place.placeId, label: place.formattedAddress || place.name, place } : null,
    line1: [a.line1, a.line2].filter(Boolean).join(", "),
    landmark: a.landmark ?? "",
    area: [a.districtName, a.stateName].filter(Boolean).join(", "),
    state: a.state,
    pincode: a.pincode,
  };
}

function validate(v: Values, today: IsoDate): { errors: Errors; body: CreateShipmentRequest | null } {
  const errors: Errors = {};
  const w = weightProblem(v.weight, v.unit);
  if (w) errors.weight = w;
  if (!v.packageType) errors.packageType = "Choose a package type";
  const d = dateProblem(v.date, today);
  if (d) errors.date = d;
  for (const side of ["source", "destination"] as const) {
    if (!v[side].state) errors[`${side}.state`] = "Choose a state";
  }
  if (v.source.search?.placeId && v.source.search.placeId === v.destination.search?.placeId)
    errors["destination.search"] = "Pickup and delivery are the same place";
  const body: CreateShipmentRequest = {
    source: toAddress(v.source),
    destination: toAddress(v.destination),
    receiver: { name: v.receiverName, phone: v.receiverPhone },
    package: {
      weightKg: weightToKg(v.weight, v.unit) ?? 0,
      goodsCategory: v.goodsCategory,
      packageType: (v.packageType || "box") as PackageType,
      description: v.description,
      pieces: Number(v.pieces),
      specialHandling: v.specialHandling,
      declaredValueRupees: null,
      prohibitedItemsDeclaration: v.prohibited as true,
    },
    shippingDate: v.date,
  };
  const r = CreateShipmentRequestSchema.safeParse(body);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const key = fieldOf(issue.path.join("."));
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  return { errors, body: Object.keys(errors).length ? null : body };
}

/**
 * New Shipment (P3 §4.3): pickup, delivery, receiver and package sections. Saves the shipment
 * server-side, then opens Find Vehicles for it (or, with `?trip=`, that vehicle's details).
 * `?edit=<shipmentId>` edits an open shipment instead.
 */
export function NewShipmentView() {
  const params = useSearchParams();
  const editId = params.get("edit");
  const existing = useApi(editId ? `customer:shipment:${editId}` : null, (signal) => customerApi.shipment(editId!, signal));

  if (editId) {
    if (existing.loading) return <FormPageSkeleton />;
    if (existing.error || !existing.data)
      return (
        <div className={PAGE}>
          <PageHeader title="Edit shipment" backHref={paths.customer.shipments} />
          <LoadError error={existing.error} title="We couldn't load this shipment" onRetry={() => void existing.reload()} />
        </div>
      );
    return <ShipmentEditor existing={existing.data} />;
  }
  return <ShipmentEditor existing={null} />;
}

function ShipmentEditor({ existing }: { existing: ShipmentDTO | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const profile = useProfile();
  const tripId = params.get("trip");
  const [today] = useState(() => todayIst(new Date()));
  const [values, setValues] = useState<Values>(() => {
    if (existing) {
      return {
        source: fromAddress(existing.source),
        destination: fromAddress(existing.destination),
        receiverName: existing.receiver.name,
        receiverPhone: localPhone(existing.receiver.phone),
        weight: String(existing.package.weightKg),
        unit: "kg",
        packageType: existing.package.packageType,
        goodsCategory: existing.package.goodsCategory,
        description: existing.package.description,
        pieces: String(existing.package.pieces),
        specialHandling: existing.package.specialHandling,
        date: existing.shippingDate >= today ? existing.shippingDate : addDaysIso(today, 1),
        prohibited: true,
      };
    }
    const p = parseSearchPrefill(params);
    return {
      source: emptyAddress({ placeId: p.from, label: p.fromLabel }),
      destination: emptyAddress({ placeId: p.to, label: p.toLabel }),
      receiverName: "",
      receiverPhone: "",
      weight: p.weightKg ? String(p.weightKg) : "",
      unit: "kg",
      packageType: "",
      goodsCategory: p.goods ?? "general_goods",
      description: "",
      pieces: "1",
      specialHandling: p.handling ?? [],
      date: p.date && p.date >= today ? p.date : addDaysIso(today, 1),
      prohibited: false,
    };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [iAmReceiver, setIAmReceiver] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key as string]) setErrors((e) => ({ ...e, [key as string]: undefined }));
  }
  function setAddress(side: "source" | "destination", patch: Partial<AddressForm>) {
    setValues((v) => ({ ...v, [side]: { ...v[side], ...patch } }));
    const touched = Object.keys(patch).map((k) => `${side}.${k}`);
    if (touched.some((k) => errors[k])) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !touched.includes(k))));
  }

  function toggleReceiver(checked: boolean) {
    setIAmReceiver(checked);
    if (checked && profile.state.status === "ready" && profile.state.profile.role === "customer") {
      const p = profile.state.profile;
      setValues((v) => ({ ...v, receiverName: p.fullName, receiverPhone: localPhone(p.phone) }));
      setErrors((e) => ({ ...e, receiverName: undefined, receiverPhone: undefined }));
    }
  }

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`#${domId(first)}`);
    el?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const { errors: errs, body } = validate(values, today);
    setErrors(errs);
    if (!body) {
      focusFirst(errs);
      return;
    }
    setSaving(true);
    try {
      const saved = existing ? await customerApi.updateShipment(existing.id, body) : await customerApi.createShipment(body);
      toast({ tone: "success", title: existing ? "Shipment updated" : "Shipment saved" });
      router.push(tripId ? vehicleDetailsHref(tripId, { shipmentId: saved.id }) : vehiclesHref({ shipmentId: saved.id }));
    } catch (err) {
      setSaving(false);
      if (isApiError(err) && err.fields) {
        const mapped: Errors = {};
        for (const [k, msg] of Object.entries(err.fields)) mapped[fieldOf(k)] = msg;
        setErrors(mapped);
        focusFirst(mapped);
      }
      setFormError(errorMessage(err));
    }
  }

  const err = (f: string) => errors[f];

  return (
    <div className={PAGE}>
      <PageHeader
        title={existing ? "Edit shipment" : "New Shipment"}
        subtitle="Tell us what you're sending and where. You'll see matching vehicles next."
        backHref={paths.customer.dashboard}
        backLabel="Back to dashboard"
        actions={<StepPill />}
      />
      <form ref={formRef} noValidate onSubmit={onSubmit} aria-label={existing ? "Edit shipment" : "New shipment"} className="flex flex-col gap-5 pb-24 lg:pb-0">
        <AddressSection side="source" title="Pickup (Source)" value={values.source} errors={errors} onChange={(p) => setAddress("source", p)} />
        <AddressSection side="destination" title="Delivery (Destination)" value={values.destination} errors={errors} onChange={(p) => setAddress("destination", p)} />

        <Section title="Receiver" icon={<UserRound strokeWidth={1.75} />} id="ns-receiver">
          <Checkbox
            label="I am the receiver"
            checked={iAmReceiver}
            disabled={profile.state.status !== "ready"}
            onChange={(e) => toggleReceiver(e.target.checked)}
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <FormField label="Receiver name" htmlFor={domId("receiverName")} error={err("receiverName")} required>
              <Input autoComplete="off" value={values.receiverName} onChange={(e) => set("receiverName", e.target.value)} maxLength={60} />
            </FormField>
            <FormField label="Receiver phone" htmlFor={domId("receiverPhone")} error={err("receiverPhone")} required>
              <PhoneInput value={values.receiverPhone} onChange={(e) => set("receiverPhone", e.target.value.replace(/\D/g, "").slice(0, 10))} />
            </FormField>
          </div>
        </Section>

        <Section title="Cargo Details" icon={<PackageSearch strokeWidth={1.75} />} id="ns-package">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            <FormField label="Weight" htmlFor={domId("weight")} error={err("weight")} required>
              <Input
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 500"
                className="tabular-nums"
                value={values.weight}
                onChange={(e) => set("weight", e.target.value)}
                trailingSlot={
                  <select
                    aria-label="Weight unit"
                    value={values.unit}
                    onChange={(e) => {
                      const next = e.target.value as WeightUnit;
                      const kg = weightToKg(values.weight, values.unit);
                      setValues((v) => ({ ...v, unit: next, weight: kg !== null ? kgToUnitString(kg, next) : v.weight }));
                    }}
                    className="h-11 rounded-sm bg-transparent px-2 text-base font-medium text-ink hover:bg-surface-muted"
                  >
                    {WEIGHT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                }
              />
            </FormField>
            <FormField label="Number of pieces" htmlFor={domId("pieces")} error={err("pieces")} required>
              <Input inputMode="numeric" value={values.pieces} onChange={(e) => set("pieces", e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </FormField>
            <FormField label="Package type" htmlFor={domId("packageType")} error={err("packageType")} required>
              <Select placeholder="Select package type" options={[...PACKAGE_OPTIONS]} value={values.packageType} onChange={(e) => set("packageType", e.target.value as PackageType)} />
            </FormField>
            <FormField label="Goods category" htmlFor={domId("goodsCategory")} error={err("goodsCategory")} hint="Agencies accept or restrict goods by category." required>
              <Select options={[...GOODS_OPTIONS]} value={values.goodsCategory} onChange={(e) => set("goodsCategory", e.target.value as GoodsCategory)} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <FormField label="Goods description" htmlFor={domId("description")} error={err("description")} required>
              <Textarea rows={2} maxLength={300} value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 20 cartons of packaged snacks" />
            </FormField>
            <FormField label="Shipping date" htmlFor={domId("date")} error={err("date")} hint={values.date ? formatDate(values.date) : undefined} required>
              <Input type="date" min={today} max={maxPickupDate(today)} value={values.date} onChange={(e) => set("date", e.target.value)} />
            </FormField>
          </div>
          <ChoiceChips multiple legend="Special handling (optional)" options={HANDLING_OPTIONS} value={values.specialHandling} onChange={(v) => set("specialHandling", v as SpecialHandling[])} />
          <Checkbox
            id={domId("prohibited")}
            label="My shipment has no prohibited or hazardous items"
            description="Explosives, flammables, weapons, narcotics and live animals can't be shipped."
            checked={values.prohibited}
            error={err("prohibited")}
            onChange={(e) => set("prohibited", e.target.checked)}
          />
        </Section>

        {formError ? (
          <p role="alert" className="rounded-md bg-danger-100 px-4 py-3 text-sm text-error">
            {formError}
          </p>
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 shadow-raised lg:static lg:flex lg:items-center lg:justify-between lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <Link
            href={paths.customer.dashboard}
            className="hidden min-h-11 items-center gap-2 rounded-md px-1 font-heading text-[15px] font-semibold text-green-700 hover:text-green-800 lg:inline-flex"
          >
            <ArrowLeft aria-hidden="true" strokeWidth={2} className="size-5" />
            Back to previous
          </Link>
          <Button type="submit" size="lg" loading={saving} trailingIcon={<ArrowRight strokeWidth={2} />} className="w-full lg:w-auto lg:min-w-[18rem]">
            {saving ? "Saving…" : tripId ? "Save and continue" : "Find Matching Vehicles"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** "Step 1 of 2 · Route and cargo" (step 2 = choosing a vehicle on Find Vehicles). */
function StepPill() {
  return (
    <div className="hidden items-center gap-3 rounded-lg bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-950 sm:flex">
      <PackageSearch aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-700" />
      <span>
        Step 1 of 2 <span className="text-ink-subtle">·</span> Route and cargo
      </span>
      <span aria-hidden="true" className="flex items-center">
        <span className="size-2.5 rounded-full bg-green-700" />
        <span className="h-0.5 w-10 bg-green-300" />
        <span className="size-2.5 rounded-full border-2 border-green-300 bg-surface" />
      </span>
    </div>
  );
}

function Section({ title, icon, id, children }: { title: string; icon: ReactNode; id: string; children: ReactNode }) {
  return (
    <Card as="section" padding="md" aria-labelledby={`${id}-heading`} className="flex flex-col gap-4 lg:px-8">
      <h2 id={`${id}-heading`} className="type-h3 flex items-center gap-2 text-ink">
        <span aria-hidden="true" className="flex text-green-600 [&_svg]:size-5">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

type GeoState = { status: "idle" } | { status: "locating" } | { status: "done"; accuracy: number; note: string | null } | { status: "error"; message: string };

const resolvePlace = async (input: { address: string } | { placeId: string }) => (await mapsApi.geocode(input)).place;

function AddressSection({
  side,
  title,
  value,
  errors,
  onChange,
}: {
  side: "source" | "destination";
  title: string;
  value: AddressForm;
  errors: Errors;
  onChange(patch: Partial<AddressForm>): void;
}) {
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const id = (f: string) => domId(`${side}.${f}`);
  const err = (f: string) => errors[`${side}.${f}`];

  // A prefilled place (from the quick-ship search) without a resolved address: resolve it once.
  useEffect(() => {
    const s = value.search;
    if (!s || s.place || value.line1) return;
    let alive = true;
    resolvePlace(s.placeId ? { placeId: s.placeId } : { address: s.label })
      .then((place) => {
        if (alive) onChange({ search: { placeId: place.placeId, label: s.label, place }, ...prefillFrom(place) });
      })
      .catch(() => {
        if (alive) onChange({ search: null, mode: "manual" });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({ status: "error", message: "Location isn't available on this device. Search or enter the address." });
      onChange({ mode: "manual" });
      return;
    }
    setGeo({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        try {
          const { place, inServiceArea } = await mapsApi.reverseGeocode(lat, lng);
          onChange({ mode: "current_location", location: { lat, lng }, search: null, ...prefillFrom(place) });
          setGeo({
            status: "done",
            accuracy: Math.round(pos.coords.accuracy),
            note: inServiceArea ? "Check the address and add your door number." : "This location is outside the area TAKI serves.",
          });
        } catch (e) {
          onChange({ mode: "current_location", location: { lat, lng } });
          setGeo({ status: "done", accuracy: Math.round(pos.coords.accuracy), note: isApiError(e) ? e.message : "Enter the address yourself." });
        }
      },
      (e) => {
        onChange({ mode: "manual", location: undefined });
        setGeo({
          status: "error",
          message: e.code === e.PERMISSION_DENIED ? "Location permission was denied. Search or enter the address." : "We couldn't get your location. Search or enter the address.",
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <Section title={title} icon={<MapPin strokeWidth={1.75} />} id={`ns-${side}`}>
      {side === "source" ? (
        <div className="flex flex-col gap-2">
          <ChoiceChips
            legend="Pickup location"
            options={[
              { value: "current_location", label: "Use current location", icon: <Crosshair strokeWidth={1.75} /> },
              { value: "autocomplete", label: "Search address" },
            ]}
            value={value.mode === "current_location" ? "current_location" : "autocomplete"}
            onChange={(m) => {
              if (m === "current_location") locate();
              else {
                onChange({ mode: "autocomplete", location: undefined });
                setGeo({ status: "idle" });
              }
            }}
          />
          <p aria-live="polite" className="text-sm text-ink-muted">
            {geo.status === "locating" ? "Getting your location…" : null}
            {geo.status === "done" ? `Location captured (±${geo.accuracy} m). ${geo.note ?? ""}` : null}
            {geo.status === "error" ? <span className="text-info-700">{geo.message}</span> : null}
          </p>
        </div>
      ) : null}
      {value.mode !== "current_location" ? (
        <FormField
          label="Find the address"
          htmlFor={id("search")}
          error={err("search")}
          hint="Pick a suggestion to fill the address. You can still edit every field."
        >
          <PlaceAutocompleteInput
            id={id("search")}
            kind="address"
            value={value.search}
            resolve={resolvePlace}
            resolveSelection
            placeholder="Street, area or town"
            onChange={(sel) =>
              onChange(sel?.place ? { mode: "autocomplete", search: sel, ...prefillFrom(sel.place) } : { mode: sel ? "autocomplete" : "manual", search: sel })
            }
          />
        </FormField>
      ) : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FormField label="Full address" htmlFor={id("line1")} error={err("line1")} hint={value.area ? `Area: ${value.area}` : undefined} required>
          <Input maxLength={120} autoComplete="street-address" value={value.line1} onChange={(e) => onChange({ line1: e.target.value })} placeholder="Door no., street, area" />
        </FormField>
        <FormField label="Landmark" htmlFor={id("landmark")} error={err("landmark")} optionalLabel>
          <Input maxLength={80} value={value.landmark} onChange={(e) => onChange({ landmark: e.target.value })} />
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FormField label="State" htmlFor={id("state")} error={err("state")} required>
          <Select placeholder="Select state" options={[...STATE_OPTIONS]} value={value.state} onChange={(e) => onChange({ state: isStateCode(e.target.value) ? e.target.value : "" })} />
        </FormField>
        <FormField label="Pincode" htmlFor={id("pincode")} error={err("pincode")} required>
          <Input inputMode="numeric" autoComplete="postal-code" maxLength={6} value={value.pincode} onChange={(e) => onChange({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
        </FormField>
      </div>
    </Section>
  );
}

function FormPageSkeleton() {
  return (
    <div className={PAGE} aria-busy="true">
      <span className="sr-only">Loading shipment…</span>
      <Skeleton className="mb-8 h-8 w-56" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mb-5 h-56 rounded-lg" />
      ))}
    </div>
  );
}
