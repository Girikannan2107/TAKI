"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, PasswordInput, PhoneInput, Tabs } from "@/components/ui";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { dashboardFor, paths, PUBLIC_ROLES, type PublicRole } from "@/lib/config/routes";
import { digitsOnly, mobileField } from "@/lib/schemas/phone.schema";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { FormAlert, ROLE_LABEL, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { setSessionUser } from "./session";

const loginSchema = z.object({ mobile: mobileField, password: z.string().min(1, "Enter your password") });
type LoginValues = z.infer<typeof loginSchema>;

const COPY: Record<PublicRole, { title: string; subtitle: string; signup: string }> = {
  customer: { title: "Welcome back", subtitle: "Log in to ship and track your goods", signup: "Create a customer account" },
  agency: { title: "Travel agency login", subtitle: "Manage trips, vehicles, drivers and bookings", signup: "Register your agency" },
  driver: { title: "Driver login", subtitle: "See your assigned trips and shipments", signup: "Sign up as a driver" },
};

/** /auth/login?role=customer|agency|driver — one page, role tabs synced with ?role. */
export function LoginView() {
  const { next, role: roleParam } = useAuthQuery();
  const router = useRouter();
  const role: PublicRole = roleParam ?? "customer";
  const [serviceError, setServiceError] = useState<ReactNode>(null);
  const panelId = "login-panel";

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { mobile: "", password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  function switchRole(r: PublicRole) {
    setServiceError(null);
    router.replace(paths.login({ role: r, next }), { scroll: false });
  }

  async function onSubmit(values: LoginValues) {
    setServiceError(null);
    try {
      const user = await authApi.login({ role, phone: values.mobile, password: values.password });
      setSessionUser(user);
      router.replace(safeRedirect(next, user.role) ?? dashboardFor(user.role));
    } catch (e) {
      if (isApiError(e) && e.details?.reason === "wrong_role" && typeof e.details.role === "string" && PUBLIC_ROLES.includes(e.details.role as PublicRole)) {
        const other = e.details.role as PublicRole;
        setServiceError(
          <>
            This number is registered as a {ROLE_LABEL[other]} account.{" "}
            <button type="button" onClick={() => switchRole(other)} className={authLinkClasses + " min-h-0"}>
              Switch to {ROLE_LABEL[other]} login
            </button>
          </>,
        );
      } else if (isApiError(e) && e.code === "account_locked") {
        setServiceError(
          <>
            {e.message}{" "}
            <Link href={paths.resetPassword(role, next)} className={authLinkClasses + " min-h-0"}>
              Reset password
            </Link>
          </>,
        );
      } else {
        setServiceError(errorMessage(e));
      }
    }
  }

  const copy = COPY[role];

  return (
    <>
      <AuthCardHeader title={copy.title} subtitle={copy.subtitle} backHref={paths.home} backLabel="Back to home" />

      <Tabs
        ariaLabel="Log in as"
        items={PUBLIC_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
        value={role}
        onChange={(v) => switchRole(v as PublicRole)}
        panelId={panelId}
        className="mb-5"
      />

      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${role}`}>
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
                  autoComplete="username"
                  onChange={(e) => {
                    setServiceError(null);
                    field.onChange(digitsOnly(e.target.value));
                  }}
                />
              </FormField>
            )}
          />
          <FormField label="Password" htmlFor="password" error={errors.password?.message} required>
            <PasswordInput placeholder="Enter password" autoComplete="current-password" {...register("password", { onChange: () => setServiceError(null) })} />
          </FormField>

          <div className="-mt-2 flex justify-end">
            <Link href={paths.resetPassword(role, next)} className={authLinkClasses + " text-sm"}>
              Forgot password?
            </Link>
          </div>

          <FormAlert>{serviceError}</FormAlert>

          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            {isSubmitting ? "Logging in…" : "Log In"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          New to TAKI?{" "}
          <Link href={paths.signup(role, next)} className={authLinkClasses}>
            {copy.signup}
          </Link>
        </p>
      </div>
    </>
  );
}
