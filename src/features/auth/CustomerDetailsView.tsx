"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, UserRound } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, Input } from "@/components/ui";
import { maxDobFor } from "@/lib/api/contracts/auth";
import { paths } from "@/lib/config/routes";
import { AuthSkeleton, SignupStepper } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, useAuthFlow } from "./flow-store";
import { customerDetailsSchema, type CustomerDetailsValues } from "./signup-schemas";
import { TermsCheckbox } from "./TermsCheckbox";

/** /signup/customer — step 1 of 3: name, date of birth (18+), terms. */
export function CustomerDetailsView() {
  const flow = useAuthFlow();
  if (!flow) return <AuthSkeleton fields={3} />;
  const draft = flow.draft?.role === "customer" ? flow.draft.details : null;
  return <CustomerDetailsForm initial={draft} />;
}

function CustomerDetailsForm({ initial }: { initial: { fullName: string; dob: string } | null }) {
  const router = useRouter();
  const { next } = useAuthQuery();
  const maxDob = maxDobFor();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerDetailsValues>({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: { fullName: initial?.fullName ?? "", dob: initial?.dob ?? "", acceptTerms: !!initial },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  function onSubmit(values: CustomerDetailsValues) {
    authFlow.setDraft({
      role: "customer",
      details: { fullName: values.fullName.trim().replace(/\s+/g, " "), dob: values.dob },
      acceptTerms: true,
    });
    router.push(paths.phone({ flow: "signup", role: "customer", next }));
  }

  return (
    <>
      <AuthCardHeader title="Create your account" subtitle="Ship goods with verified travel agencies" backHref={paths.signup(undefined, next)} backLabel="Back to account type" />
      <SignupStepper role="customer" current={0} />
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField label="Full name" htmlFor="fullName" error={errors.fullName?.message} required>
          <Input leadingIcon={<UserRound strokeWidth={1.75} />} autoComplete="name" placeholder="As on your ID" {...register("fullName")} />
        </FormField>
        <FormField label="Date of birth" htmlFor="dob" error={errors.dob?.message} hint="You must be 18 or older to use TAKI." required>
          <Input type="date" max={maxDob} min="1900-01-01" leadingIcon={<CalendarDays strokeWidth={1.75} />} autoComplete="bday" {...register("dob")} />
        </FormField>
        <TermsCheckbox registration={register("acceptTerms")} error={errors.acceptTerms?.message} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Continue
        </Button>
      </form>
    </>
  );
}
