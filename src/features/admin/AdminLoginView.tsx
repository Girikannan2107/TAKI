"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, PasswordInput, PhoneInput } from "@/components/ui";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { digitsOnly, mobileField } from "@/lib/schemas/phone.schema";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { FormAlert } from "@/features/auth/AuthBits";
import { setSessionUser } from "@/features/auth/session";

const schema = z.object({ mobile: mobileField, password: z.string().min(1, "Enter your password") });
type Values = z.infer<typeof schema>;

/** /admin/login — hidden staff sign-in (no public links). Admin accounts come from seed / ops only. */
export function AdminLoginView() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [serviceError, setServiceError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { mobile: "", password: "" } });

  async function onSubmit(values: Values) {
    setServiceError(null);
    try {
      const user = await authApi.login({ role: "admin", phone: values.mobile, password: values.password });
      setSessionUser(user);
      router.replace(safeRedirect(next, "admin") ?? paths.admin.dashboard);
    } catch (e) {
      // Never reveal which role a number belongs to on the staff page.
      if (isApiError(e) && e.code === "forbidden") setServiceError("This account can't sign in here.");
      else setServiceError(errorMessage(e));
    }
  }

  return (
    <>
      <AuthCardHeader title="TAKI admin" subtitle="Staff sign-in for agency and driver verification." />
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4">
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
          <PasswordInput autoComplete="current-password" {...register("password", { onChange: () => setServiceError(null) })} />
        </FormField>
        <FormAlert>{serviceError}</FormAlert>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} leadingIcon={<ShieldCheck className="size-5" />}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}
