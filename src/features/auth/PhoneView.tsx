"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { Button, FormField, PhoneInput } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { DomainError } from "@/lib/domain/db";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { digitsOnly, phoneSchema, type PhoneFormValues } from "@/lib/schemas/phone.schema";
import { authService } from "@/lib/services/auth";
import { errorMessage } from "@/lib/services/marketplace";
import { useTakiStore } from "@/lib/store";
import { AuthSkeleton, FormAlert, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";

/** /auth/phone — mobile number step (screen 03) for the signup, login (OTP) and reset flows. */
export function PhoneView() {
  const hydrated = useHydrated();
  const { flow, role, next } = useAuthQuery();
  const router = useRouter();
  const needsRole = flow === "signup" && !role;

  useEffect(() => {
    if (needsRole) router.replace(paths.signup(undefined, next));
  }, [needsRole, next, router]);

  if (!hydrated || needsRole) return <AuthSkeleton label={needsRole ? "Redirecting" : "Loading"} />;
  return <PhoneForm flow={flow} role={flow === "signup" ? role : undefined} next={next} />;
}

function PhoneForm({ flow, role, next }: Pick<ReturnType<typeof useAuthQuery>, "flow" | "role" | "next">) {
  const router = useRouter();
  // "Change number" returns here: prefill the number from the same flow.
  const pending = useTakiStore((s) => s.pendingAuth);
  const prefill = pending && pending.flow === flow ? pending.mobile.replace(/^\+91/, "") : "";
  const [serviceError, setServiceError] = useState<ReactNode>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { mobile: prefill },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const backHref = flow === "signup" ? paths.signup(role, next) : paths.login(next);
  const backLabel = flow === "signup" ? "Back to account type" : "Back to log in";

  async function onSubmit({ mobile }: PhoneFormValues) {
    setServiceError(null);
    try {
      await authService.sendOtp({ mobile, flow, role, next });
      router.push(paths.verifyOtp({ flow, role, next }));
    } catch (e) {
      if (e instanceof DomainError && e.code === "account_exists") {
        setServiceError(
          <>
            {e.message}{" "}
            <Link href={paths.login(next)} className={authLinkClasses + " min-h-0"}>
              Log in
            </Link>
          </>,
        );
      } else if (e instanceof DomainError && e.code === "no_account") {
        setServiceError(
          <>
            {e.message}{" "}
            <Link href={paths.signup(undefined, next)} className={authLinkClasses + " min-h-0"}>
              Create an account
            </Link>
          </>,
        );
      } else {
        setServiceError(errorMessage(e));
      }
    }
  }

  return (
    <>
      <AuthCardHeader
        title="Enter your mobile number"
        subtitle="We'll generate a one-time password (OTP) for verification."
        backHref={backHref}
        backLabel={backLabel}
      />
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <Controller
          control={control}
          name="mobile"
          render={({ field }) => (
            <FormField label="Mobile number" htmlFor="mobile" error={errors.mobile?.message} required>
              <PhoneInput
                name={field.name}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(e) => {
                  setServiceError(null);
                  field.onChange(digitsOnly(e.target.value));
                }}
                autoFocus
              />
            </FormField>
          )}
        />

        <FormAlert>{serviceError}</FormAlert>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? "Generating OTP…" : "Send OTP"}
        </Button>

        <DemoBanner kind="otp" compact>
          Your code will be shown on the next screen.
        </DemoBanner>
      </form>
    </>
  );
}
