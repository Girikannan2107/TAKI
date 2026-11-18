"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronRight, IdCard, ShieldCheck, Truck } from "lucide-react";
import { Badge, Button, Card, ChoiceChips, FormField, Input, Select, Skeleton, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountPhotoCard, ChangePasswordCard, ChangePhoneCard, STATE_CHOICES } from "@/features/account";
import { PlaceAutocompleteInput, type PlaceSelection } from "@/components/maps/PlaceAutocompleteInput";
import { mapsApi } from "@/lib/api/client/auth";
import { agencyApi, type AgencyProfileResponse } from "@/lib/api/client/agency";
import { DOCUMENT_LABELS } from "@/lib/api/contracts/auth";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { VEHICLE_COUNT_RANGES, type StateCode, type VehicleCountRange } from "@/lib/domain/model";
import { fieldErrorsOf, when } from "./format";
import { VERIFICATION } from "./labels";
import { AgencyReviewsCard } from "./AgencyReviewsCard";
import { LoadError } from "./states";
import { useApi } from "./useApi";

/** Agency profile (`/agency/profile`, P3 §4.4): agency details, logo/photo, verification, phone & password, fleet shortcuts. */
export function AgencyProfileView() {
  const { state, reload, setData } = useApi("agency-profile", agencyApi.profile);
  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[860px]">
        <PageHeader title="Profile" />
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">Loading profile…</span>
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-[860px]">
        <PageHeader title="Profile" />
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your profile" />
      </div>
    );
  }
  const p = state.data;
  const v = VERIFICATION[p.verification.status];
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <PageHeader title="Profile" subtitle={p.agencyName} />
      <div className="flex flex-col gap-5">
        <DetailsCard profile={p} onSaved={setData} />

        <div className="grid gap-5 md:grid-cols-2">
          <AccountPhotoCard
            name={p.agencyName}
            photoUrl={p.photoUrl}
            label="Agency logo or photo"
            description="Shown to customers on your trips."
            onChanged={(url) => setData({ ...p, photoUrl: url })}
          />
          <Card as="section" aria-labelledby="verif-title" className="flex flex-col gap-3">
            <h2 id="verif-title" className="type-h3 flex items-center gap-2 text-ink">
              <ShieldCheck aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-600" /> Verification
            </h2>
            <p>
              <Badge tone={v.tone} size="md">
                {v.label}
              </Badge>
            </p>
            {p.verification.status === "rejected" && p.verification.reason ? <p className="text-sm text-error">Reason: {p.verification.reason}</p> : null}
            <ul className="text-sm text-ink">
              {p.documents.length === 0 ? (
                <li className="text-ink-muted">No identity document uploaded yet.</li>
              ) : (
                p.documents.map((d) => (
                  <li key={d.kind}>
                    {DOCUMENT_LABELS[d.kind]} <span className="text-ink-muted">{d.numberMasked}</span>
                  </li>
                ))
              )}
            </ul>
            {p.verification.reviewedAt ? <p className="text-xs text-ink-subtle">Reviewed {when(p.verification.reviewedAt)}</p> : null}
            <Link href={paths.agency.verification()} className="mt-auto inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-green-700 underline-offset-4 hover:underline">
              {p.verification.status === "verified" ? "View documents" : "Update documents"}
              <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
            </Link>
          </Card>
        </div>

        <AgencyReviewsCard agencyId={p.agencyId} ratingAvg={p.stats.ratingAvg} ratingCount={p.stats.ratingCount} />

        <Card as="section" aria-labelledby="fleet-title">
          <h2 id="fleet-title" className="type-h3 mb-3 text-ink">
            Fleet
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href={paths.agency.vehicles} className="flex min-h-14 items-center justify-between gap-2 rounded-md border border-border px-4 py-3 hover:bg-surface-muted">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <Truck aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-600" /> Vehicles ({p.counts.vehicles})
              </span>
              <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4 text-ink-muted" />
            </Link>
            <Link href={paths.agency.drivers(p.counts.pendingDrivers ? "pending" : undefined)} className="flex min-h-14 items-center justify-between gap-2 rounded-md border border-border px-4 py-3 hover:bg-surface-muted">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <IdCard aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-600" /> Drivers ({p.counts.drivers})
                {p.counts.pendingDrivers ? <Badge tone="attention">{p.counts.pendingDrivers} pending</Badge> : null}
              </span>
              <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4 text-ink-muted" />
            </Link>
          </div>
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          <ChangePhoneCard phoneMasked={p.phoneMasked} />
          <ChangePasswordCard />
        </div>
      </div>
    </div>
  );
}

function DetailsCard({ profile, onSaved }: { profile: AgencyProfileResponse; onSaved(p: AgencyProfileResponse): void }) {
  const { toast } = useToast();
  const [ownerName, setOwnerName] = useState(profile.ownerName);
  const [agencyName, setAgencyName] = useState(profile.agencyName);
  const initialBase: PlaceSelection | null = profile.base ? { placeId: profile.base.placeId, label: profile.base.formattedAddress || profile.base.name, place: profile.base } : null;
  const [base, setBase] = useState<PlaceSelection | null>(initialBase);
  const [states, setStates] = useState<StateCode[]>(profile.statesCovered);
  const [range, setRange] = useState<VehicleCountRange>(profile.vehicleCountRange);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty =
    ownerName !== profile.ownerName ||
    agencyName !== profile.agencyName ||
    (base?.placeId ?? "") !== (initialBase?.placeId ?? "") ||
    range !== profile.vehicleCountRange ||
    states.join() !== profile.statesCovered.join();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (ownerName.trim().length < 2) local.ownerName = "Enter the owner's name";
    if (agencyName.trim().length < 2) local.agencyName = "Enter the agency name";
    if (!base?.placeId) local.base = "Choose the town or city you are based in";
    if (!states.length) local.statesCovered = "Choose at least one state";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const p = await agencyApi.updateProfile({
        ownerName: ownerName.trim(),
        agencyName: agencyName.trim(),
        base: { placeId: base!.placeId },
        statesCovered: states,
        vehicleCountRange: range,
      });
      onSaved(p);
      toast({ title: "Profile saved", tone: "success" });
    } catch (err) {
      const f = fieldErrorsOf(err);
      setErrors(f);
      if (!Object.keys(f).length) toast({ title: "Couldn't save your profile", description: errorMessage(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="agency-details-title" padding="lg">
      <h2 id="agency-details-title" className="type-h3 mb-4 text-ink">
        Agency details
      </h2>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField label="Owner name" htmlFor="ap-owner" error={errors.ownerName} required>
            <Input id="ap-owner" value={ownerName} maxLength={60} invalid={!!errors.ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" />
          </FormField>
          <FormField label="Agency name" htmlFor="ap-agency" error={errors.agencyName} required>
            <Input id="ap-agency" value={agencyName} maxLength={80} invalid={!!errors.agencyName} onChange={(e) => setAgencyName(e.target.value)} autoComplete="organization" />
          </FormField>
          <FormField label="Based in" htmlFor="ap-base" error={errors.base} required>
            <PlaceAutocompleteInput
              id="ap-base"
              kind="cities"
              value={base}
              onChange={setBase}
              resolve={async (input) => (await mapsApi.geocode(input)).place}
              invalid={!!errors.base}
            />
          </FormField>
          <FormField label="Number of vehicles" htmlFor="ap-range" error={errors.vehicleCountRange} required>
            <Select id="ap-range" options={VEHICLE_COUNT_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={(e) => setRange(e.target.value as VehicleCountRange)} />
          </FormField>
        </div>
        <ChoiceChips<StateCode> multiple legend="States covered" required options={STATE_CHOICES} value={states} onChange={setStates} error={errors.statesCovered} />
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
