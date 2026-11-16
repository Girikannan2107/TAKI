"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, UserRound } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, ChoiceChips, FormField, Input } from "@/components/ui";
import { PlaceAutocompleteInput } from "@/components/maps/PlaceAutocompleteInput";
import { paths } from "@/lib/config/routes";
import { VEHICLE_COUNT_RANGES, type StateCode, type VehicleCountRange } from "@/lib/domain/model";
import { STATE_CHOICES } from "@/features/account/district-options";
import { AuthSkeleton, SignupStepper } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, useAuthFlow, type AgencyDraft } from "./flow-store";
import { agencyDetailsSchema, type AgencyDetailsValues } from "./signup-schemas";
import { TermsCheckbox } from "./TermsCheckbox";

const RANGE_CHOICES = VEHICLE_COUNT_RANGES.map((r) => ({ value: r, label: r === "50+" ? "50+" : r.replace("-", "–") }));

/** /signup/agency — step 1 of 4: owner, agency, base town (Places), fleet size, states covered, terms (wide card). */
export function AgencyDetailsView() {
  const flow = useAuthFlow();
  if (!flow) return <AuthSkeleton fields={5} />;
  const draft = flow.draft?.role === "agency" ? flow.draft.details : null;
  return <AgencyDetailsForm initial={draft} />;
}

function AgencyDetailsForm({ initial }: { initial: AgencyDraft | null }) {
  const router = useRouter();
  const { next } = useAuthQuery();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AgencyDetailsValues>({
    resolver: zodResolver(agencyDetailsSchema),
    defaultValues: {
      ownerName: initial?.ownerName ?? "",
      agencyName: initial?.agencyName ?? "",
      base: initial?.base,
      vehicleCountRange: initial?.vehicleCountRange ?? "",
      statesCovered: initial?.statesCovered ?? [],
      acceptTerms: !!initial,
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  function onSubmit(values: AgencyDetailsValues) {
    authFlow.setDraft({
      role: "agency",
      details: {
        ownerName: values.ownerName.trim().replace(/\s+/g, " "),
        agencyName: values.agencyName.trim().replace(/\s+/g, " "),
        base: { placeId: values.base.placeId, label: values.base.label.trim() },
        vehicleCountRange: values.vehicleCountRange as VehicleCountRange,
        statesCovered: values.statesCovered as StateCode[],
      },
      acceptTerms: true,
    });
    router.push(paths.phone({ flow: "signup", role: "agency", next }));
  }

  return (
    <div data-auth-wide>
      <AuthCardHeader title="Register your agency" subtitle="List trips, manage vehicles and drivers, and accept bookings" backHref={paths.signup(undefined, next)} backLabel="Back to account type" />
      <SignupStepper role="agency" current={0} />
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Owner name" htmlFor="ownerName" error={errors.ownerName?.message} required>
            <Input leadingIcon={<UserRound strokeWidth={1.75} />} autoComplete="name" placeholder="Full name" {...register("ownerName")} />
          </FormField>
          <FormField label="Agency name" htmlFor="agencyName" error={errors.agencyName?.message} required>
            <Input leadingIcon={<Building2 strokeWidth={1.75} />} autoComplete="organization" placeholder="e.g. Kovai Travels" {...register("agencyName")} />
          </FormField>
        </div>
        <Controller
          control={control}
          name="base"
          render={({ field }) => (
            <FormField label="Based in" htmlFor="base" error={errors.base?.message} hint="The town or city your agency operates from." required>
              <PlaceAutocompleteInput id="base" kind="cities" value={field.value ?? null} onChange={(v) => field.onChange(v ?? undefined)} placeholder="Town or city" />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="vehicleCountRange"
          render={({ field }) => (
            <ChoiceChips
              legend="How many vehicles do you run?"
              name={field.name}
              options={RANGE_CHOICES}
              value={field.value as VehicleCountRange | ""}
              onChange={(v) => field.onChange(v)}
              error={errors.vehicleCountRange?.message}
              required
            />
          )}
        />
        <Controller
          control={control}
          name="statesCovered"
          render={({ field }) => (
            <ChoiceChips
              multiple
              legend="States you cover"
              name={field.name}
              options={STATE_CHOICES}
              value={field.value as StateCode[]}
              onChange={(v) => field.onChange(v)}
              hint="Choose every state your trips run through."
              error={errors.statesCovered?.message}
              required
            />
          )}
        />
        <TermsCheckbox registration={register("acceptTerms")} error={errors.acceptTerms?.message} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Continue
        </Button>
      </form>
    </div>
  );
}
