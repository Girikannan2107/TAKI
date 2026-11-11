"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { Button, FormField, PasswordInput, PhoneInput } from "@/components/ui";
import { dashboardFor, paths } from "@/lib/config/routes";
import { DEMO_PASSWORD } from "@/lib/domain/constants";
import { normalizeIndianMobile } from "@/lib/domain/phone";
import type { Role } from "@/lib/domain/types";
import { DEMO_ACCOUNTS } from "@/lib/data/seed";
import { formatPhone } from "@/lib/format";
import { loginSchema, type LoginFormValues } from "@/lib/schemas/login.schema";
import { digitsOnly } from "@/lib/schemas/phone.schema";
import { authService } from "@/lib/services/auth";
import { errorMessage } from "@/lib/services/marketplace";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { FormAlert, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";

const DEMO_FILL: Record<Role, { label: string; who: string; mobile: string }> = {
  customer: {
    label: "Fill demo customer",
    who: `Customer · ${DEMO_ACCOUNTS.customer.name.split(" ")[0]}`,
    mobile: DEMO_ACCOUNTS.customer.mobile,
  },
  driver: {
    label: "Fill demo driver",
    who: `Driver · ${DEMO_ACCOUNTS.driver.name.split(" ")[0]} · ${DEMO_ACCOUNTS.driver.business}`,
    mobile: DEMO_ACCOUNTS.driver.mobile,
  },
};

/** /auth/login — password login (no board screen; same card style as 03/05). */
export function LoginView() {
  const { next, role: roleHint } = useAuthQuery();
  const router = useRouter();
  const [serviceError, setServiceError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { mobile: "", password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  async function onSubmit(values: LoginFormValues) {
    setServiceError(null);
    try {
      const session = await authService.login(values);
      router.replace(safeRedirect(next, session.role) ?? dashboardFor(session.role));
    } catch (e) {
      setServiceError(errorMessage(e));
    }
  }

  function fillDemo(role: Role) {
    setServiceError(null);
    clearErrors();
    setValue("mobile", normalizeIndianMobile(DEMO_FILL[role].mobile) ?? "", { shouldDirty: true });
    setValue("password", DEMO_PASSWORD, { shouldDirty: true });
  }

  const demoOrder: Role[] = roleHint === "driver" ? ["driver", "customer"] : ["customer", "driver"];

  return (
    <>
      <AuthCardHeader title="Welcome back" subtitle="Log in to continue" backHref={paths.home} backLabel="Back to home" />

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
              />
            </FormField>
          )}
        />
        <FormField label="Password" htmlFor="password" error={errors.password?.message} required>
          <PasswordInput
            placeholder="Enter password"
            autoComplete="current-password"
            {...register("password", { onChange: () => setServiceError(null) })}
          />
        </FormField>

        <div className="-mt-2 flex justify-end">
          <Link href={paths.phone({ flow: "reset", next })} className={authLinkClasses + " text-sm"}>
            Forgot password?
          </Link>
        </div>

        <FormAlert>{serviceError}</FormAlert>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log In"}
        </Button>
      </form>

      <div className="mt-3 flex flex-col items-center text-sm">
        <Link href={paths.phone({ flow: "login", next })} className={authLinkClasses}>
          Log in with OTP instead
        </Link>
        <p className="text-ink-muted">
          New to TAKI?{" "}
          <Link href={paths.signup(undefined, next)} className={authLinkClasses}>
            Create an account
          </Link>
        </p>
      </div>

      <DemoBanner kind="general" title="Demo credentials" className="mt-5">
        <ul className="mt-1 flex flex-col gap-1">
          {demoOrder.map((role) => (
            <li key={role}>
              <span className="font-medium">{DEMO_FILL[role].who}</span>{" "}
              <span className="whitespace-nowrap tabular-nums">{formatPhone(DEMO_FILL[role].mobile)}</span>
            </li>
          ))}
          <li>
            Password <code className="rounded-sm bg-surface/70 px-1.5 py-0.5 font-mono text-[13px]">{DEMO_PASSWORD}</code>
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {demoOrder.map((role) => (
            <Button key={role} variant="outline" size="sm" onClick={() => fillDemo(role)} className="bg-surface">
              {DEMO_FILL[role].label}
            </Button>
          ))}
        </div>
      </DemoBanner>
    </>
  );
}
