"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { Button, ButtonLink, OtpInput, useToast } from "@/components/ui";
import { dashboardFor, paths } from "@/lib/config/routes";
import type { OtpChallenge } from "@/lib/domain/types";
import { formatPhone, pad2 } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { isCompleteOtp, OTP_MESSAGES } from "@/lib/schemas/otp.schema";
import { authService } from "@/lib/services/auth";
import { errorMessage } from "@/lib/services/marketplace";
import { useTakiStore, type PendingAuth } from "@/lib/store";
import { getNow } from "@/lib/utils/clock";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { AuthSkeleton, FormAlert, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";

/** /auth/verify-otp — screen 04. Requires a pending OTP challenge from the phone step. */
export function VerifyOtpView() {
  const hydrated = useHydrated();
  const query = useAuthQuery();
  const pending = useTakiStore((s) => s.pendingAuth);
  const otp = useTakiStore((s) => s.otp);
  const router = useRouter();
  /** Set once this page navigates away itself, so the missing-state guard doesn't race it. */
  const leavingRef = useRef(false);
  const missing = hydrated && (!pending || (!otp && !pending.verified));

  useEffect(() => {
    if (missing && !leavingRef.current) router.replace(paths.phone({ flow: query.flow, role: query.role, next: query.next }));
  }, [missing, query, router]);

  if (!hydrated || missing || !pending) return <AuthSkeleton fields={2} label={missing ? "Redirecting" : "Loading"} />;
  if (pending.verified) return <VerifiedNotice pending={pending} next={pending.next ?? query.next} />;
  if (!otp) return <AuthSkeleton fields={2} />;
  return <VerifyForm pending={pending} otp={otp} next={pending.next ?? query.next} leavingRef={leavingRef} />;
}

function phoneLine(mobile: string) {
  const formatted = formatPhone(mobile);
  const rest = formatted.startsWith("+91 ") ? formatted.slice(4) : formatted;
  return (
    <strong className="mt-1 block font-heading text-lg font-bold text-ink">
      {formatted.startsWith("+91 ") ? <span className="text-green-700">+91 </span> : null}
      {rest}
    </strong>
  );
}

/** Already verified (e.g. came back from the password step): offer to continue instead of re-verifying. */
function VerifiedNotice({ pending, next }: { pending: PendingAuth; next?: string }) {
  const flow = pending.flow === "reset" ? "reset" : "signup";
  return (
    <>
      <AuthCardHeader
        title="Verify OTP"
        subtitle={<>Your number is verified{phoneLine(pending.mobile)}</>}
        backHref={paths.phone({ flow: pending.flow, role: pending.role, next })}
        backLabel="Change number"
      />
      <p className="mb-6 flex items-center justify-center gap-2 text-sm font-medium text-success-700">
        <CircleCheck aria-hidden="true" strokeWidth={2} className="size-5" />
        Verified
      </p>
      <ButtonLink href={paths.createPassword({ flow, role: pending.role, next })} size="lg" fullWidth>
        Continue
      </ButtonLink>
      <p className="mt-4 text-center text-sm">
        <Link href={paths.phone({ flow: pending.flow, role: pending.role, next })} className={authLinkClasses}>
          Change number
        </Link>
      </p>
    </>
  );
}

function secondsUntil(iso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - nowMs) / 1000));
}

function VerifyForm({
  pending,
  otp,
  next,
  leavingRef,
}: {
  pending: PendingAuth;
  otp: OtpChallenge;
  next?: string;
  leavingRef: MutableRefObject<boolean>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState("");
  const [nowMs, setNowMs] = useState(() => getNow().getTime());
  const busy = useRef(false);

  const flow = pending.flow;
  const phoneHref = paths.phone({ flow, role: flow === "signup" ? pending.role : undefined, next });
  const remaining = secondsUntil(otp.resendAvailableAt, nowMs);
  const canResend = remaining === 0;

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(getNow().getTime()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Polite announcements only on changes (the countdown itself is not live): available → resent.
  const liveStatus = canResend ? "You can now request a new code." : status;

  function resetInput() {
    setCode("");
    setInputKey((k) => k + 1); // remount: re-focuses Digit 1 and replays the shake
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
    setExpired(false);
    try {
      const result = await authService.verifyOtp(value);
      if (result.ok) {
        leavingRef.current = true;
        if (result.flow === "login" && result.session) {
          const role = result.session.role;
          router.replace(safeRedirect(next, role) ?? dashboardFor(role));
        } else {
          const nextFlow = result.flow === "reset" ? "reset" : "signup";
          router.push(paths.createPassword({ flow: nextFlow, role: nextFlow === "signup" ? pending.role : undefined, next }));
        }
        return;
      }
      switch (result.reason) {
        case "invalid": {
          const left = result.attemptsLeft ?? 0;
          setError(`Incorrect code. ${left} ${left === 1 ? "attempt" : "attempts"} left.`);
          resetInput();
          break;
        }
        case "expired":
          setExpired(true);
          setError("Code expired. Request a new one.");
          resetInput();
          break;
        case "too_many_attempts":
          leavingRef.current = true;
          toast({
            tone: "error",
            title: "Too many incorrect attempts",
            description: "Enter your number again to get a new code.",
          });
          router.replace(phoneHref);
          useTakiStore.getState().setOtp(null);
          return;
        case "no_challenge":
          leavingRef.current = true;
          router.replace(phoneHref);
          return;
      }
    } catch (e) {
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
      await authService.resendOtp();
      setExpired(false);
      resetInput();
      setNowMs(getNow().getTime());
      setStatus("A new code has been generated.");
    } catch (e) {
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
        subtitle={<>Enter the 6-digit code for{phoneLine(pending.mobile)}</>}
        backHref={phoneHref}
        backLabel="Back to mobile number"
      />

      <DemoBanner kind="otp" className="mb-5">
        Your code is{" "}
        <strong data-testid="demo-otp-code" className="font-heading font-bold tracking-[0.15em] tabular-nums">
          {otp.code}
        </strong>
      </DemoBanner>

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <fieldset className="min-w-0">
          <legend className="sr-only">Enter the 6-digit code</legend>
          <OtpInput
            key={inputKey}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error && !expired && v.length > 0) setError(null);
            }}
            onComplete={(v) => void verify(v)}
            invalid={!!error}
            disabled={verifying}
            autoFocus
            aria-describedby={error ? errorId : undefined}
          />
        </fieldset>

        <FormAlert id={errorId}>{error}</FormAlert>

        <div className="flex min-h-11 items-center justify-center text-sm text-green-700">
          {canResend ? (
            <Button variant="ghost" size="sm" onClick={resend} loading={resending} className="font-semibold">
              {resending ? "Generating…" : "Resend OTP"}
            </Button>
          ) : (
            <p>
              Resend OTP in{" "}
              <strong className="font-heading text-base font-bold text-ink tabular-nums">
                {mm}:{ss}
              </strong>
            </p>
          )}
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
