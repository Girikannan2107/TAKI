"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Check, Circle, UserRound } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, Input, PasswordInput, useToast } from "@/components/ui";
import { dashboardFor, paths } from "@/lib/config/routes";
import { firstName } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  createPasswordSchema,
  PASSWORD_RULES,
  type CreatePasswordFormValues,
} from "@/lib/schemas/password.schema";
import { authService } from "@/lib/services/auth";
import { errorMessage } from "@/lib/services/marketplace";
import { useTakiStore, type PendingAuth } from "@/lib/store";
import { cn } from "@/lib/utils/cn";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { AuthSkeleton, FormAlert } from "./AuthBits";
import { useAuthQuery } from "./auth-query";

/** /auth/create-password — screen 05 (signup) and the password-reset step. Requires a verified OTP. */
export function CreatePasswordView() {
  const hydrated = useHydrated();
  const query = useAuthQuery();
  const pending = useTakiStore((s) => s.pendingAuth);
  const router = useRouter();
  const leavingRef = useRef(false);
  const ready = !!pending?.verified && pending.flow !== "login";
  const missing = hydrated && !ready;

  useEffect(() => {
    if (missing && !leavingRef.current) router.replace(paths.phone({ flow: query.flow, role: query.role, next: query.next }));
  }, [missing, query, router]);

  if (!hydrated || !ready || !pending) return <AuthSkeleton fields={3} label={missing ? "Redirecting" : "Loading"} />;
  return <PasswordForm pending={pending} next={pending.next ?? query.next} leavingRef={leavingRef} />;
}

function PasswordForm({ pending, next, leavingRef }: { pending: PendingAuth; next?: string; leavingRef: MutableRefObject<boolean> }) {
  const router = useRouter();
  const { toast } = useToast();
  const isSignup = pending.flow === "signup";
  const isDriver = isSignup && pending.role === "driver";
  const schema = useMemo(() => createPasswordSchema({ requireName: isSignup }), [isSignup]);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<CreatePasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", businessName: "", password: "", confirmPassword: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const password = useWatch({ control, name: "password" }) ?? "";
  const rules = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) }));
  const metCount = rules.filter((r) => r.met).length;
  const summary =
    password === ""
      ? ""
      : metCount === rules.length
        ? "All password rules met."
        : `${metCount} of ${rules.length} password rules met.`;

  async function onSubmit(values: CreatePasswordFormValues) {
    setServiceError(null);
    try {
      if (isSignup) {
        leavingRef.current = true;
        const session = await authService.createAccount({
          fullName: values.fullName,
          password: values.password,
          businessName: isDriver ? values.businessName : undefined,
        });
        toast({ tone: "success", title: `Welcome to TAKI, ${firstName(values.fullName.trim())}` });
        router.replace(safeRedirect(next, session.role) ?? dashboardFor(session.role));
      } else {
        leavingRef.current = true;
        await authService.resetPassword(values.password);
        toast({ tone: "success", title: "Password updated", description: "Log in with your new password." });
        router.replace(paths.login(next));
      }
    } catch (e) {
      leavingRef.current = false;
      setServiceError(errorMessage(e));
    }
  }

  const backHref = paths.verifyOtp({ flow: pending.flow, role: isSignup ? pending.role : undefined, next });

  return (
    <>
      <AuthCardHeader
        title="Create a Password"
        subtitle="Set a password to secure your account."
        backHref={backHref}
        backLabel="Back to verification"
      />
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4">
        {isSignup ? (
          <FormField label="Full name" htmlFor="fullName" error={errors.fullName?.message} required>
            <Input
              leadingIcon={<UserRound strokeWidth={1.75} />}
              autoComplete="name"
              placeholder="Enter your full name"
              {...register("fullName")}
            />
          </FormField>
        ) : null}
        {isDriver ? (
          <FormField label="Business name" htmlFor="businessName" error={errors.businessName?.message} optionalLabel>
            <Input
              leadingIcon={<Building2 strokeWidth={1.75} />}
              autoComplete="organization"
              placeholder="e.g. Raj Transport"
              {...register("businessName")}
            />
          </FormField>
        ) : null}

        <FormField label="Password" htmlFor="password" error={errors.password?.message} required hideLabel={!isSignup}>
          <PasswordInput
            placeholder="Enter password"
            autoComplete="new-password"
            aria-describedby="password-rules"
            {...register("password")}
          />
        </FormField>
        <FormField
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
          required
          hideLabel={!isSignup}
        >
          <PasswordInput placeholder="Confirm password" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <ul id="password-rules" aria-label="Password rules" className="flex flex-col gap-1.5 text-sm">
          {rules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-2",
                r.met ? "text-ink" : isSubmitted ? "text-error" : "text-ink-muted",
              )}
            >
              {r.met ? (
                <Check aria-hidden="true" strokeWidth={2.25} className="size-4 shrink-0 text-green-600" />
              ) : (
                <Circle aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-ink-subtle" />
              )}
              <span>{r.label}</span>
              <span className="sr-only">{r.met ? "(met)" : "(not met)"}</span>
            </li>
          ))}
        </ul>
        <p role="status" aria-live="polite" className="sr-only">
          {summary}
        </p>

        <FormAlert>{serviceError}</FormAlert>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          {isSignup
            ? isSubmitting
              ? "Creating account…"
              : "Create Account"
            : isSubmitting
              ? "Saving…"
              : "Save Password"}
        </Button>
      </form>
    </>
  );
}
