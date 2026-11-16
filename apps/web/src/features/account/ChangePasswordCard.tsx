"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { Button, Card, FormField, PasswordInput, useToast } from "@/components/ui";
import { PasswordSchema } from "@/lib/api/contracts/common";
import { accountApi } from "@/lib/api/client/auth";
import { signInWithAuthResult } from "@/features/auth/session";
import { errorMessage, isApiError } from "@/lib/api/http";
import { FormAlert } from "@/features/auth/AuthBits";
import { PASSWORD_RULES } from "@/features/auth/password-rules";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: z.string().min(1, "Enter a new password").pipe(PasswordSchema),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" })
  .refine((v) => v.password !== v.currentPassword, { path: ["password"], message: "Choose a password you haven't used here" });
type Values = z.input<typeof schema>;

const EMPTY: Values = { currentPassword: "", password: "", confirmPassword: "" };

/** Change password (POST /api/me/password). Other devices are signed out; this one stays signed in. */
export function ChangePasswordCard({ className }: { className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY, mode: "onSubmit", reValidateMode: "onChange" });

  async function onSubmit(values: Values) {
    setServiceError(null);
    try {
      // E15 revokes every session; this device signs straight back in with the returned token.
      await signInWithAuthResult(await accountApi.changePassword(values));
      reset(EMPTY);
      setOpen(false);
      toast({ tone: "success", title: "Password changed", description: "Other devices have been signed out." });
    } catch (e) {
      if (isApiError(e) && e.fields) {
        for (const [k, msg] of Object.entries(e.fields)) {
          if (k === "currentPassword" || k === "password" || k === "confirmPassword") setError(k, { message: msg });
        }
        if (!Object.keys(e.fields).some((k) => k in EMPTY)) setServiceError(e.message);
      } else {
        setServiceError(errorMessage(e));
      }
    }
  }

  return (
    <Card as="section" aria-labelledby="change-password-title" className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="change-password-title" className="type-h3 text-ink">
            Password
          </h2>
          <p className="text-sm text-ink-muted">Use 8–64 characters with at least one letter and one number.</p>
        </div>
        {!open ? (
          <Button variant="secondary" size="sm" leadingIcon={<KeyRound className="size-4" />} onClick={() => setOpen(true)}>
            Change password
          </Button>
        ) : null}
      </div>

      {open ? (
        <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mt-4 flex flex-col gap-4">
          <FormField label="Current password" htmlFor="currentPassword" error={errors.currentPassword?.message} required>
            <PasswordInput autoComplete="current-password" {...register("currentPassword")} />
          </FormField>
          <FormField
            label="New password"
            htmlFor="newPassword"
            error={errors.password?.message}
            hint={PASSWORD_RULES.map((r) => r.label).join(" · ")}
            required
          >
            <PasswordInput id="newPassword" autoComplete="new-password" {...register("password")} />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirmNewPassword" error={errors.confirmPassword?.message} required>
            <PasswordInput id="confirmNewPassword" autoComplete="new-password" {...register("confirmPassword")} />
          </FormField>
          <FormAlert>{serviceError}</FormAlert>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                reset(EMPTY);
                setServiceError(null);
                setOpen(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save password"}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
