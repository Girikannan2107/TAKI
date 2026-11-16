"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, OtpInput, useToast } from "@/components/ui";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage } from "@/lib/api/http";
import { firebaseErrorCode, firebaseErrorMessage } from "@/lib/auth/errors";
import { clearPhoneProof, confirmPhoneOtp, phoneProofToken, sendPhoneOtp } from "@/lib/auth/phone-otp";
import { authEmulatorHost } from "@/lib/firebase/client";
import { paths, PUBLIC_ROLES, type PublicRole } from "@/lib/config/routes";
import { pad2 } from "@/lib/format";
import { isCompleteOtp, OTP_MESSAGES } from "@/lib/schemas/otp.schema";
import { AuthSkeleton, FormAlert, ROLE_LABEL, SignupStepper, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, useAuthFlow, type PendingOtp } from "./flow-store";

/** /auth/verify-otp — screen 04. Requires a pending Firebase phone verification from the phone step. */
export function VerifyOtpView() {
  const state = useAuthFlow();
  const query = useAuthQuery();
  const router = useRouter();
  /** Set once this page navigates away itself, so the missing-state guard doesn't race it. */
  const leavingRef = useRef(false);
  const missing = !!state && !state.otp;

  useEffect(() => {
    if (missing && !leavingRef.current) router.replace(paths.phone({ flow: query.flow, role: query.role, next: query.next }));
  }, [missing, query, router]);

  if (!state || !state.otp) return <AuthSkeleton fields={2} label={missing ? "Redirecting" : "Loading"} />;
  return <VerifyForm pending={state.otp} leavingRef={leavingRef} />;
}

const RESEND_COOLDOWN_MS = 30_000;

function VerifyForm({ pending, leavingRef }: { pending: PendingOtp; leavingRef: MutableRefObject<boolean> }) {
  const router = useRouter();
  const { toast } = useToast();
  const errorId = useId();
  const { flow, role, next, mobile, phoneMasked } = pending;
  const [code, setCode] = useState("");
  const [error, setError] = useState<ReactNode>(null);
  const [inputKey, setInputKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const busy = useRef(false);
  /** Host for the invisible reCAPTCHA used by "Resend". */
  const recaptchaRef = useRef<HTMLDivElement>(null);

  const phoneHref = paths.phone({ flow, role, next });
  const remaining = Math.max(0, Math.ceil((pending.sentAt + RESEND_COOLDOWN_MS - nowMs) / 1000));
  const canResend = remaining === 0;

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const liveStatus = canResend ? "You can now request a new code." : status;

  function resetInput() {
    setCode("");
    setInputKey((k) => k + 1); // remount: re-focuses Digit 1 and replays the shake
  }

  function startOver(title: string, description: string) {
    leavingRef.current = true;
    toast({ tone: "error", title, description });
    authFlow.clearOtp();
    router.replace(phoneHref);
  }

  async function verify(value: string) {
    if (busy.current) return;
    if (!isCompleteOtp(value)) {
      setError(OTP_MESSAGES.incomplete);
      return;
    }
    busy.current = true;
    setVerifying(true);
    setError(null);
    try {
      await confirmPhoneOtp(pending.verificationId, value);
    } catch (e) {
      busy.current = false;
      setVerifying(false);
      const fbCode = firebaseErrorCode(e);
      if (fbCode === "auth/too-many-requests") return startOver("Too many attempts", "Wait a few minutes, then enter your number again.");
      if (fbCode === "auth/invalid-verification-id" || fbCode === "auth/missing-verification-id")
        return startOver("Start again", "This verification has expired. Enter your number again.");
      setError(firebaseErrorMessage(e, "That code didn't work. Try again."));
      resetInput();
      return;
    }
    try {
      const phone = await authApi.phoneStatus(await phoneProofToken());
      if (flow === "signup" && phone.registered) {
        await clearPhoneProof();
        const taken = phone.role && PUBLIC_ROLES.includes(phone.role as PublicRole) ? (phone.role as PublicRole) : undefined;
        setError(
          <>
            This number is already registered{taken ? ` as a ${ROLE_LABEL[taken]} account` : ""}.{" "}
            <Link href={paths.login({ role: taken, next })} className={authLinkClasses + " min-h-0"}>
              Log in
            </Link>
          </>,
        );
        return;
      }
      if (flow === "reset" && !phone.registered) {
        await clearPhoneProof();
        setError(
          <>
            There is no TAKI account for this number.{" "}
            <Link href={paths.signup(role, next)} className={authLinkClasses + " min-h-0"}>
              Sign up
            </Link>
          </>,
        );
        return;
      }
      leavingRef.current = true;
      authFlow.setProof({
        flow,
        role,
        mobile,
        phoneMasked: phone.phoneMasked || phoneMasked,
        verifiedAt: Date.now(),
        registered: phone.registered,
        accountRole: phone.role,
        invite: phone.invite,
        next,
      });
      router.push(paths.createPassword({ flow, role, next }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      if (!leavingRef.current) setVerifying(false);
    }
  }

  async function resend() {
    if (!recaptchaRef.current) return;
    setResending(true);
    setError(null);
    try {
      const { verificationId } = await sendPhoneOtp(mobile, recaptchaRef.current);
      authFlow.updateOtp({ verificationId, sentAt: Date.now() });
      resetInput();
      setNowMs(Date.now());
      setStatus("A new code has been sent.");
    } catch (e) {
      if (firebaseErrorCode(e) === "auth/too-many-requests") return startOver("Too many codes requested", "Wait a few minutes, then try again.");
      setError(firebaseErrorMessage(e, "We couldn't send a new code. Please try again."));
    } finally {
      setResending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void verify(code);
  }

  const mm = pad2(Math.floor(remaining / 60));
  const ss = pad2(remaining % 60);

  return (
    <>
      <AuthCardHeader
        title="Verify OTP"
        subtitle={
          <>
            Enter the 6-digit code sent to
            <strong className="mt-1 block font-heading text-lg font-bold tabular-nums text-ink">{phoneMasked}</strong>
          </>
        }
        backHref={phoneHref}
        backLabel="Back to mobile number"
      />
      {flow === "signup" ? <SignupStepper role={role} current={1} /> : null}

      {authEmulatorHost() ? (
        <p className="mb-5 rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-ink-muted">
          Local Auth emulator: no SMS is sent. Read the code from the emulator (Emulator UI, Authentication tab).
        </p>
      ) : null}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <fieldset className="min-w-0">
          <legend className="sr-only">Enter the 6-digit code</legend>
          <OtpInput
            key={inputKey}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error && v.length > 0) setError(null);
            }}
            onComplete={(v) => void verify(v)}
            invalid={!!error}
            disabled={verifying}
            autoFocus
            aria-describedby={error ? errorId : undefined}
          />
        </fieldset>

        <FormAlert id={errorId}>{error}</FormAlert>

        <div className="flex min-h-11 flex-col items-center justify-center gap-1 text-sm text-green-700">
          {canResend ? (
            <Button variant="ghost" size="sm" onClick={resend} loading={resending} className="font-semibold">
              {resending ? "Sending…" : "Resend OTP"}
            </Button>
          ) : (
            <p>
              Resend OTP in{" "}
              <strong className="font-heading text-base font-bold tabular-nums text-ink">
                {mm}:{ss}
              </strong>
            </p>
          )}
        </div>
        <div ref={recaptchaRef} id="recaptcha-anchor" />
        <p role="status" aria-live="polite" className="sr-only">
          {liveStatus}
        </p>

        <Button type="submit" size="lg" fullWidth loading={verifying} disabled={code.length !== 6 || verifying}>
          {verifying ? "Verifying…" : "Verify"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href={phoneHref} className={authLinkClasses}>
          Change number
        </Link>
      </p>
    </>
  );
}
