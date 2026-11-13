"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, RotateCcw, UserRound } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, Input, Select, Skeleton } from "@/components/ui";
import type { PublicAgencyDTO } from "@/lib/api/contracts/auth";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { STATE_NAMES } from "@/lib/domain/model";
import { AuthSkeleton, FormAlert, SignupStepper } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, useAuthFlow, type DriverDraft } from "./flow-store";
import { driverDetailsSchema, INVITE_CHOICE, type DriverDetailsValues } from "./signup-schemas";
import { TermsCheckbox } from "./TermsCheckbox";

type AgenciesState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: PublicAgencyDTO[] };

/** /signup/driver — step 1 of 4: name, associated agency (verified agencies, or "my agency added me"), terms. */
export function DriverDetailsView() {
  const flow = useAuthFlow();
  if (!flow) return <AuthSkeleton fields={3} />;
  const draft = flow.draft?.role === "driver" ? flow.draft.details : null;
  return <DriverDetailsForm initial={draft} />;
}

function agencyLabel(a: PublicAgencyDTO): string {
  return `${a.agencyName} — ${a.districtName}, ${STATE_NAMES[a.state] ?? a.state}`;
}

function DriverDetailsForm({ initial }: { initial: DriverDraft | null }) {
  const router = useRouter();
  const { next } = useAuthQuery();
  const [agencies, setAgencies] = useState<AgenciesState>({ status: "loading" });

  const load = useCallback(async () => {
    setAgencies({ status: "loading" });
    try {
      const res = await authApi.publicAgencies();
      setAgencies({ status: "ready", items: res.items });
    } catch (e) {
      setAgencies({ status: "error", message: errorMessage(e, "We couldn't load the list of agencies.") });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DriverDetailsValues>({
    resolver: zodResolver(driverDetailsSchema),
    defaultValues: { fullName: initial?.fullName ?? "", agencyId: initial?.agencyId ?? "", acceptTerms: !!initial },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  function onSubmit(values: DriverDetailsValues) {
    const chosen = agencies.status === "ready" ? agencies.items.find((a) => a.id === values.agencyId) : undefined;
    authFlow.setDraft({
      role: "driver",
      details: {
        fullName: values.fullName.trim().replace(/\s+/g, " "),
        agencyId: values.agencyId,
        agencyLabel: values.agencyId === INVITE_CHOICE ? "Invited by my agency" : chosen ? agencyLabel(chosen) : (initial?.agencyLabel ?? ""),
      },
      acceptTerms: true,
    });
    router.push(paths.phone({ flow: "signup", role: "driver", next }));
  }

  const options =
    agencies.status === "ready"
      ? [{ value: INVITE_CHOICE, label: "My agency added me (invite)" }, ...agencies.items.map((a) => ({ value: a.id, label: agencyLabel(a) }))]
      : [{ value: INVITE_CHOICE, label: "My agency added me (invite)" }];

  return (
    <>
      <AuthCardHeader title="Sign up as a driver" subtitle="Drive trips for your travel agency" backHref={paths.signup(undefined, next)} backLabel="Back to account type" />
      <SignupStepper role="driver" current={0} />
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField label="Full name" htmlFor="fullName" error={errors.fullName?.message} required>
          <Input leadingIcon={<UserRound strokeWidth={1.75} />} autoComplete="name" placeholder="As on your driving licence" {...register("fullName")} />
        </FormField>

        {agencies.status === "loading" ? (
          <div className="flex flex-col gap-1.5" aria-busy="true">
            <span className="text-sm font-medium text-ink">Associated agency</span>
            <Skeleton className="h-12 w-full" />
            <span className="sr-only">Loading agencies…</span>
          </div>
        ) : (
          <FormField
            label="Associated agency"
            htmlFor="agencyId"
            error={errors.agencyId?.message}
            hint={
              agencies.status === "ready" && agencies.items.length === 0
                ? "No verified agencies are listed yet. If your agency added you, choose “My agency added me”."
                : "Not listed? Ask your agency to add you, then choose “My agency added me”."
            }
            required
          >
            <Select leadingIcon={<Building2 strokeWidth={1.75} />} placeholder="Choose your agency" options={options} {...register("agencyId")} />
          </FormField>
        )}
        {agencies.status === "error" ? (
          <FormAlert>
            <span className="block">{agencies.message}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()} leadingIcon={<RotateCcw className="size-4" />} className="-ml-3 mt-1">
              Try again
            </Button>
          </FormAlert>
        ) : null}

        <TermsCheckbox registration={register("acceptTerms")} error={errors.acceptTerms?.message} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={agencies.status === "loading"} className="mt-1">
          Continue
        </Button>
      </form>
    </>
  );
}
