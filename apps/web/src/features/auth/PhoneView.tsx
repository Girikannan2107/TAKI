"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, PhoneInput } from "@/components/ui";
import { firebaseErrorMessage } from "@/lib/auth/errors";
import { maskIndianMobile, sendPhoneOtp } from "@/lib/auth/phone-otp";
import { paths, type PublicRole } from "@/lib/config/routes";
import { digitsOnly, phoneSchema, type PhoneFormValues } from "@/lib/schemas/phone.schema";
import { AuthSkeleton, FormAlert, SignupStepper, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, proofUsable, useAuthFlow, type AuthFlowState } from "./flow-store";

/** /auth/phone — mobile number step (screen 03) for signup (after the details step) and password recovery. */
export function PhoneView() {
  const flowState = useAuthFlow();
  const { flow, role, next } = useAuthQuery();
  const router = useRouter();
  const draftMissing = flow === "signup" && !!flowState && (!role || flowState.draft?.role !== role);

  useEffect(() => {
    if (draftMissing) router.replace(paths.signup(role, next));
  }, [draftMissing, role, next, router]);

  if (!flowState || draftMissing) return <AuthSkeleton label={draftMissing ? "Redirecting" : "Loading"} />;
  return <PhoneForm flow={flow} role={role ?? "customer"} next={next} state={flowState} />;
}

function PhoneForm({ flow, role, next, state }: { flow: "signup" | "reset"; role: PublicRole; next?: string; state: AuthFlowState }) {
  const router = useRouter();
  const prefill = state.otp && state.otp.flow === flow ? state.otp.mobile : "";
  const [serviceError, setServiceError] = useState<ReactNode>(null);
  /** Host for the invisible reCAPTCHA (Firebase phone auth). */
  const recaptchaRef = useRef<HTMLDivElement>(null);

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

  const isSignup = flow === "signup";
  const backHref = isSignup ? paths.signup(role, next) : paths.login({ role, next });
  const backLabel = isSignup ? "Back to your details" : "Back to log in";

  async function onSubmit({ mobile }: PhoneFormValues) {
    setServiceError(null);
    // M8: this number was verified a few minutes ago in this tab (e.g. the password step was abandoned):
    // continue with that proof instead of sending another SMS.
    const proof = state.proof;
    if (proofUsable(proof) && proof.flow === flow && proof.role === role && proof.mobile === mobile && (!isSignup || !proof.registered)) {
      router.push(paths.createPassword({ flow, role, next }));
      return;
    }
    if (!recaptchaRef.current) return;
    try {
      const { verificationId } = await sendPhoneOtp(mobile, recaptchaRef.current);
      authFlow.setOtp({ flow, role, mobile, phoneMasked: maskIndianMobile(mobile), verificationId, sentAt: Date.now(), next });
      router.push(paths.verifyOtp({ flow, role, next }));
    } catch (e) {
      setServiceError(firebaseErrorMessage(e, "We couldn't send the code. Please try again."));
    }
  }

  return (
    <>
      <AuthCardHeader
        title={isSignup ? "Enter your mobile number" : "Reset your password"}
        subtitle={
          isSignup
            ? "We'll send a one-time password (OTP) to verify it."
            : "Enter the mobile number on your account. We'll send a code to verify it's you."
        }
        backHref={backHref}
        backLabel={backLabel}
      />
      {isSignup ? <SignupStepper role={role} current={1} /> : null}
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-5">
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
        <div ref={recaptchaRef} id="recaptcha-anchor" />

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? "Sending OTP…" : "Send OTP"}
        </Button>
      </form>
      {!isSignup ? (
        <p className="mt-4 text-center text-sm text-ink-muted">
          Remembered it?{" "}
          <Link href={paths.login({ role, next })} className={authLinkClasses}>
            Log in
          </Link>
        </p>
      ) : null}
    </>
  );
}
