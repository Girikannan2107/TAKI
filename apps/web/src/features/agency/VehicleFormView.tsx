"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button, Card, ChoiceChips, EmptyState, FileUpload, FormField, IconButton, Input, Select, Skeleton, useToast, type FileUploadValue } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import { normalizeReg, isValidReg, type VehicleDTO, type VehicleInput } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { GOODS_CATEGORIES, type BodyType, type GoodsCategory, type SpecialHandling, type VehicleClass } from "@/lib/domain/model";
import { VEHICLE_MODELS } from "@/lib/domain/vehicles";
import { fieldErrorsOf } from "./format";
import { BODY_TYPE_OPTIONS, GOODS_LABEL, GOODS_OPTIONS, HANDLING_OPTIONS, VEHICLE_CLASS_OPTIONS } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";
import { VehiclePhoto, vehicleStatus } from "./VehiclesView";
import { EMPTY_RC_DRAFT, VehicleRcCard, rcDraftErrors, uploadRc, type RcDraft } from "./VehicleRcCard";

const MAX_PHOTOS = 5;

interface Form {
  vehicleClass: VehicleClass | "";
  modelId: string;
  makeModel: string;
  registrationNumber: string;
  maxPayloadKg: string;
  bodyType: BodyType | null;
  acceptedGoods: GoodsCategory[];
  handlingSupported: SpecialHandling[];
  length: string;
  width: string;
  height: string;
}

const EMPTY: Form = {
  vehicleClass: "",
  modelId: "",
  makeModel: "",
  registrationNumber: "",
  maxPayloadKg: "",
  bodyType: null,
  acceptedGoods: [...GOODS_CATEGORIES],
  handlingSupported: [],
  length: "",
  width: "",
  height: "",
};

function fromVehicle(v: VehicleDTO): Form {
  return {
    vehicleClass: v.vehicleClass,
    modelId: v.modelId ?? "",
    makeModel: v.makeModel,
    registrationNumber: v.registrationNumber,
    maxPayloadKg: String(v.maxPayloadKg),
    bodyType: v.bodyType,
    acceptedGoods: v.acceptedGoods,
    handlingSupported: v.handlingSupported,
    length: v.dimensionsFt ? String(v.dimensionsFt.length) : "",
    width: v.dimensionsFt ? String(v.dimensionsFt.width) : "",
    height: v.dimensionsFt ? String(v.dimensionsFt.height) : "",
  };
}

const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);

function validate(f: Form, needPhoto: boolean, photo: File | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.vehicleClass) e.vehicleClass = "Choose the vehicle type";
  if (f.makeModel.trim().length < 2) e.makeModel = "Enter the make and model";
  if (!f.registrationNumber.trim()) e.registrationNumber = "Enter the registration number";
  else if (!isValidReg(normalizeReg(f.registrationNumber))) e.registrationNumber = "Enter a valid registration number, e.g. TN 37 XX 4587";
  const kg = num(f.maxPayloadKg);
  if (kg === null) e.maxPayloadKg = "Enter the maximum load in kg";
  else if (!Number.isInteger(kg) || kg < 100 || kg > 40_000) e.maxPayloadKg = "Between 100 and 40,000 kg, whole kilograms";
  if (!f.bodyType) e.bodyType = "Choose the body type";
  if (!f.acceptedGoods.length) e.acceptedGoods = "The vehicle must be able to carry at least one goods category";
  const dims = [f.length, f.width, f.height];
  if (dims.some((d) => d.trim()) && dims.some((d) => !(num(d) && num(d)! > 0))) e.dimensionsFt = "Enter length, width and height (ft), or leave all three empty";
  if (needPhoto && !photo) e.photo = "Add a photo of the vehicle";
  return e;
}

function toBody(f: Form): VehicleInput {
  const dims = num(f.length) && num(f.width) && num(f.height) ? { length: num(f.length)!, width: num(f.width)!, height: num(f.height)! } : null;
  return {
    vehicleClass: f.vehicleClass as VehicleClass,
    modelId: (f.modelId || null) as VehicleInput["modelId"],
    makeModel: f.makeModel.trim(),
    registrationNumber: f.registrationNumber,
    maxPayloadKg: num(f.maxPayloadKg) ?? 0,
    bodyType: f.bodyType as BodyType,
    dimensionsFt: dims,
    acceptedGoods: f.acceptedGoods,
    handlingSupported: f.handlingSupported,
  };
}

/** Add vehicle (`/agency/vehicles/new`) and view/edit (`/agency/vehicles/[vehicleId]`), P3 §4.4. */
export function VehicleFormView({ vehicleId }: { vehicleId?: string }) {
  const existing = useApi<VehicleDTO | null>(`vehicle:${vehicleId ?? "new"}`, () => (vehicleId ? agencyApi.vehicle(vehicleId) : Promise.resolve(null)));
  const title = vehicleId ? "Edit vehicle" : "Add vehicle";
  if (existing.state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title={title} backHref={paths.agency.vehicles} backLabel="Back to vehicles" />
        <Skeleton className="h-[640px] rounded-lg" />
      </div>
    );
  }
  if (existing.state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title={title} backHref={paths.agency.vehicles} backLabel="Back to vehicles" />
        {existing.state.code === "not_found" ? (
          <EmptyState title="Vehicle not found" action={{ label: "Back to vehicles", href: paths.agency.vehicles }} />
        ) : (
          <LoadError message={existing.state.message} onRetry={existing.reload} />
        )}
      </div>
    );
  }
  return <VehicleForm key={existing.state.data?.updatedAt ?? "new"} vehicle={existing.state.data} onSaved={existing.setData} />;
}

function VehicleForm({ vehicle, onSaved }: { vehicle: VehicleDTO | null; onSaved(v: VehicleDTO): void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => (vehicle ? fromVehicle(vehicle) : EMPTY));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoValue, setPhotoValue] = useState<FileUploadValue | null>(null);
  const [rcDraft, setRcDraft] = useState<RcDraft>(EMPTY_RC_DRAFT);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      if (!(k in e)) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  function chooseModel(id: string) {
    const m = VEHICLE_MODELS.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      modelId: id,
      vehicleClass: m?.vehicleClass ?? f.vehicleClass,
      makeModel: m && !f.makeModel ? m.label : f.makeModel,
      maxPayloadKg: m && !f.maxPayloadKg ? String(m.maxPayloadKg) : f.maxPayloadKg,
    }));
  }

  async function uploadPhoto(id: string, file: File): Promise<VehicleDTO | null> {
    setPhotoValue({ name: file.name, status: "uploading", sizeBytes: file.size });
    try {
      const v = await agencyApi.addVehiclePhoto(id, file);
      setPhotoValue(null);
      setPhoto(null);
      return v;
    } catch (e) {
      setPhotoValue({ name: file.name, status: "error", error: errorMessage(e), sizeBytes: file.size });
      return null;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local = { ...validate(form, !vehicle, photo), ...(vehicle ? {} : rcDraftErrors(rcDraft, false)) };
    setErrors(local);
    if (Object.keys(local).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setSaving(true);
    try {
      const body = toBody(form);
      if (vehicle) {
        const v = await agencyApi.updateVehicle(vehicle.id, body);
        onSaved(v);
        toast({ title: "Vehicle saved", description: v.registrationNumber, tone: "success" });
      } else {
        const v = await agencyApi.createVehicle(body);
        const withPhoto = photo ? await uploadPhoto(v.id, photo) : v;
        if (!withPhoto) {
          toast({ title: "Vehicle added, but the photo didn't upload", description: "Add it again from the vehicle page.", tone: "error" });
          router.replace(paths.agency.vehicle(v.id));
          return;
        }
        if (rcDraft.file) {
          try {
            await uploadRc(v.id, rcDraft);
          } catch (rcErr) {
            toast({ title: "Vehicle added, but the RC didn't upload", description: errorMessage(rcErr), tone: "error" });
            router.replace(paths.agency.vehicle(v.id));
            return;
          }
        }
        toast({
          title: "Vehicle added",
          description: rcDraft.file ? v.registrationNumber : `${v.registrationNumber} · upload its RC before publishing a trip`,
          tone: "success",
        });
        router.push(rcDraft.file ? paths.agency.vehicles : paths.agency.vehicle(v.id));
      }
    } catch (err) {
      const fields = fieldErrorsOf(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast({ title: "Couldn't save the vehicle", description: errorMessage(err), tone: "error" });
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
    } finally {
      setSaving(false);
    }
  }

  async function addPhoto(file: File) {
    if (!vehicle) {
      setPhoto(file);
      setPhotoValue({ name: file.name, status: "selected", sizeBytes: file.size });
      setErrors((e) => ({ ...e, photo: "" }));
      return;
    }
    const v = await uploadPhoto(vehicle.id, file);
    if (v) {
      onSaved(v);
      toast({ title: "Photo added", tone: "success" });
    }
  }

  async function removePhoto(fileId: string) {
    if (!vehicle) return;
    try {
      onSaved(await agencyApi.removeVehiclePhoto(vehicle.id, fileId));
    } catch (e) {
      toast({ title: "Couldn't remove the photo", description: errorMessage(e), tone: "error" });
    }
  }

  async function toggleStatus() {
    if (!vehicle) return;
    setStatusBusy(true);
    try {
      const v = await agencyApi.updateVehicle(vehicle.id, { status: vehicle.status === "active" ? "inactive" : "active" });
      onSaved(v);
      toast({ title: v.status === "active" ? "Vehicle activated" : "Vehicle deactivated", tone: "success" });
    } catch (e) {
      toast({ title: "Couldn't change the status", description: errorMessage(e), tone: "error" });
    } finally {
      setStatusBusy(false);
    }
  }

  const modelOptions = VEHICLE_MODELS.filter((m) => !form.vehicleClass || m.vehicleClass === form.vehicleClass).map((m) => ({ value: m.id, label: m.label }));
  const restricted = GOODS_CATEGORIES.filter((g) => !form.acceptedGoods.includes(g));
  const status = vehicle ? vehicleStatus(vehicle) : null;

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader
        title={vehicle ? `${vehicle.makeModel} · ${vehicle.registrationNumber}` : "Add vehicle"}
        backHref={paths.agency.vehicles}
        backLabel="Back to vehicles"
        subtitle={status ? `${status.label}${vehicle!.activeTrips ? ` · ${vehicle!.activeTrips} live trip(s)` : ""}` : "Customers see the vehicle type, photo and what it can carry."}
        actions={
          vehicle ? (
            <Button variant="outline" loading={statusBusy} onClick={toggleStatus} disabled={vehicle.status === "active" && vehicle.activeTrips > 0}>
              {vehicle.status === "active" ? "Deactivate" : "Activate"}
            </Button>
          ) : undefined
        }
      />
      <form noValidate onSubmit={submit} aria-label={vehicle ? "Edit vehicle" : "Add vehicle"} className="flex flex-col gap-5">
        <Card as="section" aria-labelledby="veh-photo-title" padding="lg">
          <h2 id="veh-photo-title" className="type-h3 mb-4 text-ink">
            Photo
          </h2>
          {vehicle && vehicle.photos.length ? (
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {vehicle.photos.map((p, i) => (
                <li key={p.fileId} className="relative">
                  <VehiclePhoto v={{ ...vehicle, photos: [p] }} />
                  <IconButton
                    label={`Remove photo ${i + 1}`}
                    variant="surface"
                    size="sm"
                    className="absolute right-1 top-1"
                    onClick={() => void removePhoto(p.fileId)}
                    icon={<X aria-hidden="true" strokeWidth={2} />}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {!vehicle || vehicle.photos.length < MAX_PHOTOS ? (
            <FileUpload
              label={vehicle ? "Add a photo" : "Vehicle photo"}
              description="JPG or PNG, clear side view with the registration plate visible."
              kind="image"
              value={photoValue}
              onSelect={(f) => void addPhoto(f)}
              onRemove={() => {
                setPhoto(null);
                setPhotoValue(null);
              }}
              error={errors.photo || undefined}
              required={!vehicle}
            />
          ) : (
            <p className="text-sm text-ink-muted">Maximum {MAX_PHOTOS} photos. Remove one to add another.</p>
          )}
        </Card>

        <VehicleRcCard vehicle={vehicle} onSaved={onSaved} draft={vehicle ? undefined : rcDraft} onDraftChange={vehicle ? undefined : setRcDraft} errors={errors} />

        <Card as="section" aria-labelledby="veh-details-title" padding="lg">
          <h2 id="veh-details-title" className="type-h3 mb-4 text-ink">
            Vehicle details
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormField label="Vehicle type" htmlFor="veh-class" error={errors.vehicleClass} required>
              <Select
                id="veh-class"
                placeholder="Choose a type"
                options={VEHICLE_CLASS_OPTIONS}
                value={form.vehicleClass}
                invalid={!!errors.vehicleClass}
                onChange={(e) => set("vehicleClass", e.target.value as VehicleClass)}
              />
            </FormField>
            <FormField label="Model" htmlFor="veh-model" optionalLabel hint="Prefills make, model and payload">
              <Select id="veh-model" placeholder="Other / not listed" options={modelOptions} value={form.modelId} onChange={(e) => chooseModel(e.target.value)} />
            </FormField>
            <FormField label="Make & model" htmlFor="veh-make" error={errors.makeModel} required>
              <Input id="veh-make" value={form.makeModel} maxLength={60} invalid={!!errors.makeModel} onChange={(e) => set("makeModel", e.target.value)} placeholder="e.g. Tata 407" />
            </FormField>
            <FormField label="Registration number" htmlFor="veh-reg" error={errors.registrationNumber} required hint="e.g. TN 37 XX 4587">
              <Input
                id="veh-reg"
                value={form.registrationNumber}
                autoCapitalize="characters"
                invalid={!!errors.registrationNumber}
                onChange={(e) => set("registrationNumber", e.target.value)}
                onBlur={(e) => e.target.value.trim() && set("registrationNumber", normalizeReg(e.target.value))}
              />
            </FormField>
            <FormField label="Max load" htmlFor="veh-kg" error={errors.maxPayloadKg} required>
              <Input
                id="veh-kg"
                inputMode="numeric"
                className="tabular-nums"
                trailingSlot={<span className="pr-2">kg</span>}
                value={form.maxPayloadKg}
                invalid={!!errors.maxPayloadKg}
                onChange={(e) => set("maxPayloadKg", e.target.value)}
              />
            </FormField>
          </div>
          <ChoiceChips<BodyType>
            className="mt-5"
            legend="Body type"
            required
            options={BODY_TYPE_OPTIONS}
            value={form.bodyType}
            onChange={(v) => set("bodyType", v)}
            error={errors.bodyType}
          />
          <fieldset className="mt-5 min-w-0" aria-describedby={errors.dimensionsFt ? "veh-dims-error" : undefined}>
            <legend className="mb-1.5 text-sm font-medium text-ink">
              Cargo space (ft) <span className="text-caption font-medium text-ink-subtle">(optional)</span>
            </legend>
            <div className="grid grid-cols-3 gap-3">
              {(["length", "width", "height"] as const).map((k) => (
                <FormField key={k} label={k[0]!.toUpperCase() + k.slice(1)} htmlFor={`veh-${k}`}>
                  <Input id={`veh-${k}`} inputMode="decimal" value={form[k]} invalid={!!errors.dimensionsFt} onChange={(e) => set(k, e.target.value)} />
                </FormField>
              ))}
            </div>
            {errors.dimensionsFt ? (
              <p id="veh-dims-error" className="mt-1.5 text-sm text-error">
                {errors.dimensionsFt}
              </p>
            ) : null}
          </fieldset>
        </Card>

        <Card as="section" aria-labelledby="veh-goods-title" padding="lg">
          <h2 id="veh-goods-title" className="type-h3 mb-4 text-ink">
            Goods
          </h2>
          <ChoiceChips<GoodsCategory>
            multiple
            legend="Goods this vehicle can carry"
            hint="Untick categories the vehicle can't carry. Trips can only offer these."
            options={GOODS_OPTIONS}
            value={form.acceptedGoods}
            onChange={(v) => set("acceptedGoods", v)}
            error={errors.acceptedGoods}
            required
          />
          {restricted.length ? <p className="mt-2 text-sm text-ink-muted">Restricted: {restricted.map((g) => GOODS_LABEL[g]).join(", ")}</p> : null}
          <ChoiceChips<SpecialHandling>
            multiple
            className="mt-5"
            legend="Special handling supported"
            options={HANDLING_OPTIONS}
            value={form.handlingSupported}
            onChange={(v) => set("handlingSupported", v)}
          />
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push(paths.agency.vehicles)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {vehicle ? "Save changes" : "Add vehicle"}
          </Button>
        </div>
      </form>
    </div>
  );
}
