"use client";

import { useEffect, useState } from "react";
import { Lock, Smartphone } from "lucide-react";
import { Button, Card, FormField, Modal, OtpInput, PasswordInput, PhoneInput, useToast } from "@/components/ui";
import type { OtpChallengeDTO, SessionUserDTO } from "@/lib/api/contracts/auth";
import { accountApi, authApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { digitsOnly, mobileField } from "@/lib/schemas/phone.schema";
import { DevOtpNotice, FormAlert } from "@/features/auth/AuthBits";
import { setSessionUser } from "@/features/auth/session";

export interface ChangePhoneCardProps {
  /** e.g. "+91 ••••• •3210" */
  phoneMasked: string;
  /** After the number changed (the server returns the refreshed session user). */
  onChanged?(user: SessionUserDTO): void;
  className?: string;
}

type Step =
  | { kind: "phone" }
  | { kind: "otp"; mobile: string; challenge: OtpChallengeDTO }
  | { kind: "password"; mobile: string; proofToken: string };

/**
 * Change phone via OTP (P2 §8.3): new number → code sent to the NEW number → current password → POST /api/me/phone.
 * Other devices are signed out. The new number must not belong to another account (409 phone_taken).
 */
export function ChangePhoneCard({ phoneMasked, onChanged, className }: ChangePhoneCardProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(phoneMasked);

  return (
    <Card as="section" aria-labelledby="change-phone-title" className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="change-phone-title" className="type-h3 text-ink">
            Mobile number
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
            <span className="font-medium tabular-nums text-ink">{current}</span>
            <span className="inline-flex items-center gap-1 text-caption text-ink-subtle">
              <Lock aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
              Verified via OTP
            </span>
          </p>
        </div>
        <Button variant="secondary" size="sm" leadingIcon={<Smartphone className="size-4" />} onClick={() => setOpen(true)}>
          Change number
        </Button>
      </div>
      <ChangePhoneDialog
        open={open}
        onClose={() => setOpen(false)}
        onDone={(user) => {
          setCurrent(user.phoneMasked);
          setOpen(false);
          onChanged?.(user);
        }}
      />
    </Card>
  );
}

function ChangePhoneDialog({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(user: SessionUserDTO): void }) {
  // Modal renders its body only while open, so every attempt starts from a fresh ChangePhoneSteps.
  return (
    <Modal open={open} onClose={onClose} title="Change mobile number" description="We'll send a code to your new number to verify it." size="sm">
      <ChangePhoneSteps onDone={onDone} onCancel={onClose} />
    </Modal>
  );
}

function ChangePhoneSteps({ onDone, onCancel }: { onDone(user: SessionUserDTO): void; onCancel(): void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>({ kind: "phone" });
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (step.kind !== "otp") return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [step.kind]);

  async function sendCode() {
    const parsed = mobileField.safeParse(mobile);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a valid number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await accountApi.sendPhoneChangeOtp(mobile);
      setCode("");
      setStep({ kind: "otp", mobile, challenge });
    } catch (e) {
      if (isApiError(e) && e.code === "phone_taken") setFieldError("This number is already registered to another account.");
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend(challenge: OtpChallengeDTO, m: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await authApi.resendOtp(challenge.challengeId);
      setCode("");
      setStep({ kind: "otp", mobile: m, challenge: next });
      setNowMs(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string, m: string, challenge: OtpChallengeDTO) {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.verifyOtp(challenge.challengeId, value);
      setStep({ kind: "password", mobile: m, proofToken: res.proofToken });
    } catch (e) {
      setCode("");
      if (isApiError(e) && (e.code === "too_many_attempts" || e.code === "otp_expired")) {
        setStep({ kind: "phone" });
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proofToken: string) {
    if (!password) {
      setFieldError("Enter your password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await accountApi.changePhone({ proofToken, currentPassword: password });
      setSessionUser(user);
      toast({ tone: "success", title: "Mobile number updated", description: "Other devices have been signed out." });
      onDone(user);
    } catch (e) {
      if (isApiError(e) && e.code === "invalid_credentials") setFieldError(e.message);
      else if (isApiError(e) && (e.code === "proof_expired" || e.code === "phone_taken")) {
        setStep({ kind: "phone" });
        setError(e.message);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "phone") {
    return (
      <form
        noValidate
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
      >
        <FormField label="New mobile number" htmlFor="newMobile" error={fieldError ?? undefined} required>
          <PhoneInput
            id="newMobile"
            value={mobile}
            autoFocus
            onChange={(e) => {
              setFieldError(null);
              setMobile(digitsOnly(e.target.value));
            }}
          />
        </FormField>
        <FormAlert>{error}</FormAlert>
        <StepActions onCancel={onCancel} busy={busy} submitLabel={busy ? "Sending…" : "Send code"} />
      </form>
    );
  }

  if (step.kind === "otp") {
    const wait = Math.max(0, Math.ceil((Date.parse(step.challenge.resendAvailableAt) - nowMs) / 1000));
    return (
      <form
        noValidate
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code, step.mobile, step.challenge);
        }}
      >
        <p className="text-sm text-ink-muted">
          Enter the 6-digit code sent to <strong className="tabular-nums text-ink">{step.challenge.phoneMasked}</strong>.
        </p>
        {step.challenge.devOtp ? <DevOtpNotice code={step.challenge.devOtp.code} /> : null}
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={(v) => void verify(v, step.mobile, step.challenge)}
          invalid={!!error}
          disabled={busy}
          autoFocus
        />
        <FormAlert>{error}</FormAlert>
        <div className="flex min-h-11 items-center justify-center text-sm">
          {step.challenge.resendsLeft <= 0 ? (
            <span className="text-ink-muted">No more codes can be sent. Start again later.</span>
          ) : wait > 0 ? (
            <span className="text-ink-muted">Resend code in {wait}s</span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => void resend(step.challenge, step.mobile)} disabled={busy}>
              Resend code
            </Button>
          )}
        </div>
        <StepActions onCancel={onCancel} busy={busy} disabled={code.length !== 6} submitLabel={busy ? "Verifying…" : "Verify"} />
      </form>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 pb-1"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm(step.proofToken);
      }}
    >
      <p className="text-sm text-ink-muted">Number verified. Enter your password to confirm the change.</p>
      <FormField label="Password" htmlFor="phoneChangePassword" error={fieldError ?? undefined} required>
        <PasswordInput
          id="phoneChangePassword"
          autoComplete="current-password"
          value={password}
          autoFocus
          onChange={(e) => {
            setFieldError(null);
            setPassword(e.target.value);
          }}
        />
      </FormField>
      <FormAlert>{error}</FormAlert>
      <StepActions onCancel={onCancel} busy={busy} submitLabel={busy ? "Saving…" : "Change number"} />
    </form>
  );
}

function StepActions({ onCancel, busy, disabled, submitLabel }: { onCancel(): void; busy: boolean; disabled?: boolean; submitLabel: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" loading={busy} disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  );
}
