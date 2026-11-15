"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, OtpInput, useToast } from "@/components/ui";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { pad2 } from "@/lib/format";
import { isCompleteOtp, OTP_MESSAGES } from "@/lib/schemas/otp.schema";
import { AuthSkeleton, DevOtpNotice, FormAlert, SignupStepper, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, useAuthFlow, type PendingOtp } from "./flow-store";

/** /auth/verify-otp — screen 04. Requires a pending OTP challenge from the phone step. */
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

function secondsUntil(iso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - nowMs) / 1000));
}

function VerifyForm({ pending, leavingRef }: { pending: PendingOtp; leavingRef: MutableRefObject<boolean> }) {
  const router = useRouter();
  const { toast } = useToast();
  const errorId = useId();
  const { challenge, flow, role, next } = pending;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const busy = useRef(false);

  const phoneHref = paths.phone({ flow, role, next });
  const remaining = secondsUntil(challenge.resendAvailableAt, nowMs);
  const canResend = remaining === 0 && challenge.resendsLeft > 0;
  const expired = secondsUntil(challenge.expiresAt, nowMs) === 0;

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
      const result = await authApi.verifyOtp(challenge.challengeId, value);
      leavingRef.current = true;
      authFlow.setProof({ ...result, flow, role, mobile: pending.mobile, next });
      router.push(paths.createPassword({ flow, role, next }));
      return;
    } catch (e) {
      if (isApiError(e)) {
        if (e.code === "otp_invalid") {
          const left = typeof e.details?.attemptsLeft === "number" ? e.details.attemptsLeft : null;
          authFlow.updateChallenge({ ...challenge, attemptsLeft: left ?? Math.max(0, challenge.attemptsLeft - 1) });
          setError(e.message);
          resetInput();
          return;
        }
        if (e.code === "too_many_attempts") return startOver("Too many incorrect attempts", "Enter your number again to get a new code.");
        if (e.code === "otp_expired") {
          setError(challenge.resendsLeft > 0 ? "This code has expired. Request a new one." : "This code has expired. Start again.");
          resetInput();
          return;
        }
      }
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      if (!leavingRef.current) setVerifying(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const next = await authApi.resendOtp(challenge.challengeId);
      authFlow.updateChallenge(next);
      resetInput();
      setNowMs(Date.now());
      setStatus("A new code has been sent.");
    } catch (e) {
      if (isApiError(e) && (e.code === "too_many_resends" || e.code === "otp_expired")) {
        startOver("Start again", e.message);
        return;
      }
      setError(errorMessage(e));
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
            <strong className="mt-1 block font-heading text-lg font-bold tabular-nums text-ink">{challenge.phoneMasked}</strong>
          </>
        }
        backHref={phoneHref}
        backLabel="Back to mobile number"
      />
      {flow === "signup" ? <SignupStepper role={role} current={1} /> : null}

      {challenge.devOtp ? <DevOtpNotice code={challenge.devOtp.code} className="mb-5" /> : null}

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
          {challenge.resendsLeft <= 0 ? (
            <p className="text-ink-muted">No more codes can be sent for this attempt.</p>
          ) : canResend ? (
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
          {expired ? <p className="text-error">This code has expired.</p> : null}
        </div>
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
