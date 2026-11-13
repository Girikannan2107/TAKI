"use client";

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Circle, MailCheck } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { Button, FormField, PasswordInput, useToast } from "@/components/ui";
import type { SessionUserDTO } from "@/lib/api/contracts/auth";
import { PasswordSchema } from "@/lib/api/contracts/common";
import { authApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths, type PublicRole } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { safeRedirect } from "@/lib/utils/safe-redirect";
import { AuthSkeleton, FormAlert, ROLE_LABEL, SignupStepper, afterSignupPath, authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";
import { authFlow, proofUsable, useAuthFlow, type SignupDraft, type VerifiedProof } from "./flow-store";
import { PASSWORD_RULES } from "./password-rules";
import { setSessionUser } from "./session";
import { INVITE_CHOICE } from "./signup-schemas";

const schema = z
  .object({ password: z.string().min(1, "Enter a password").pipe(PasswordSchema), confirmPassword: z.string().min(1, "Confirm your password") })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" });
type Values = z.input<typeof schema>;

/** /auth/create-password — screen 05: creates the account (signup) or sets a new password (reset). Needs a verified OTP. */
export function CreatePasswordView() {
  const state = useAuthFlow();
  const query = useAuthQuery();
  const router = useRouter();
  const leavingRef = useRef(false);
  const proof = state?.proof ?? null;
  const ready = !!state && proofUsable(proof) && (proof.flow === "reset" || state.draft?.role === proof.role);
  const missing = !!state && !ready;

  useEffect(() => {
    if (!missing || leavingRef.current) return;
    if (query.flow === "signup" && state && state.draft?.role !== query.role) router.replace(paths.signup(query.role, query.next));
    else router.replace(paths.phone({ flow: query.flow, role: query.role, next: query.next }));
  }, [missing, query, router, state]);

  if (!state || !ready || !proof) return <AuthSkeleton fields={3} label={missing ? "Redirecting" : "Loading"} />;
  return <PasswordForm proof={proof} draft={state.draft} leavingRef={leavingRef} />;
}

function signupRequest(
  draft: SignupDraft,
  proof: VerifiedProof,
  values: Values,
  driverLink: { inviteId?: string; agencyId?: string },
): Promise<SessionUserDTO> {
  const common = { proofToken: proof.proofToken, password: values.password, confirmPassword: values.confirmPassword, acceptTerms: true as const };
  switch (draft.role) {
    case "customer":
      return authApi.signupCustomer({ ...common, fullName: draft.details.fullName, dob: draft.details.dob });
    case "agency":
      return authApi.signupAgency({ ...common, ...draft.details });
    case "driver":
      return authApi.signupDriver({ ...common, fullName: draft.details.fullName, ...driverLink });
  }
}

/** Invite (accepted) wins; otherwise the agency chosen on the details step. */
function driverLinkFor(draft: SignupDraft, proof: VerifiedProof, useInvite: boolean): { inviteId?: string; agencyId?: string } {
  if (draft.role !== "driver") return {};
  if (proof.invite && (useInvite || draft.details.agencyId === INVITE_CHOICE)) return { inviteId: proof.invite.inviteId };
  if (draft.details.agencyId && draft.details.agencyId !== INVITE_CHOICE) return { agencyId: draft.details.agencyId };
  return {};
}

function PasswordForm({ proof, draft, leavingRef }: { proof: VerifiedProof; draft: SignupDraft | null; leavingRef: MutableRefObject<boolean> }) {
  const router = useRouter();
  const { toast } = useToast();
  const isSignup = proof.flow === "signup";
  const role: PublicRole = proof.role;
  const next = proof.next;
  const [serviceError, setServiceError] = useState<ReactNode>(null);
  const [useInvite, setUseInvite] = useState(true);

  // Driver chose "My agency added me" but no invite exists for this number.
  const inviteMissing = isSignup && draft?.role === "driver" && draft.details.agencyId === INVITE_CHOICE && !proof.invite;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirmPassword: "" }, mode: "onSubmit", reValidateMode: "onChange" });

  const password = useWatch({ control, name: "password" }) ?? "";
  const rules = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) }));
  const metCount = rules.filter((r) => r.met).length;
  const summary = password === "" ? "" : metCount === rules.length ? "All password rules met." : `${metCount} of ${rules.length} password rules met.`;

  async function onSubmit(values: Values) {
    setServiceError(null);
    try {
      if (isSignup && draft) {
        leavingRef.current = true;
        const user = await signupRequest(draft, proof, values, driverLinkFor(draft, proof, useInvite));
        authFlow.clear();
        setSessionUser(user);
        toast({ tone: "success", title: `Welcome to TAKI, ${user.name.split(" ")[0]}` });
        router.replace((role === "customer" ? safeRedirect(next, role) : null) ?? afterSignupPath(role));
      } else {
        leavingRef.current = true;
        const res = await authApi.resetPassword({ proofToken: proof.proofToken, password: values.password, confirmPassword: values.confirmPassword });
        authFlow.clear();
        toast({ tone: "success", title: "Password updated", description: "Log in with your new password." });
        const accountRole = res.role === "admin" ? undefined : res.role;
        router.replace(paths.login({ role: accountRole, next }));
      }
    } catch (e) {
      leavingRef.current = false;
      if (isApiError(e) && (e.code === "proof_expired" || e.code === "otp_expired")) {
        setServiceError(
          <>
            {e.message}{" "}
            <Link href={paths.phone({ flow: proof.flow, role, next })} className={authLinkClasses + " min-h-0"}>
              Verify again
            </Link>
          </>,
        );
      } else if (isApiError(e) && e.code === "phone_taken") {
        setServiceError(
          <>
            This number is already registered.{" "}
            <Link href={paths.login({ role, next })} className={authLinkClasses + " min-h-0"}>
              Log in
            </Link>
          </>,
        );
      } else {
        setServiceError(errorMessage(e));
      }
    }
  }

  const backHref = paths.verifyOtp({ flow: proof.flow, role, next });

  return (
    <>
      <AuthCardHeader
        title={isSignup ? "Create a Password" : "Set a new password"}
        subtitle={isSignup ? "Set a password to secure your account." : "Choose a new password for your account."}
        backHref={backHref}
        backLabel="Back to verification"
      />
      {isSignup ? <SignupStepper role={role} current={2} /> : null}

      {isSignup && draft?.role === "driver" && proof.invite ? (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-green-500/30 bg-green-50 px-4 py-3 text-sm text-ink">
          <MailCheck aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0 text-green-700" />
          <div className="min-w-0">
            <p className="font-semibold">Invited by {proof.invite.agencyName}</p>
            {draft.details.agencyId === INVITE_CHOICE ? (
              <p className="mt-0.5 text-ink-muted">You&apos;ll join {proof.invite.agencyName} right away — no approval needed.</p>
            ) : (
              <label className="mt-1 flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5 accent-green-700" checked={useInvite} onChange={(e) => setUseInvite(e.target.checked)} />
                Join {proof.invite.agencyName} instead (no approval needed)
              </label>
            )}
          </div>
        </div>
      ) : null}

      {inviteMissing ? (
        <FormAlert className="mb-4">
          We couldn&apos;t find an invite for this number.{" "}
          <Link href={paths.signup("driver", next)} className={authLinkClasses + " min-h-0"}>
            Choose your agency
          </Link>
        </FormAlert>
      ) : null}

      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4">
        <input type="text" name="username" autoComplete="username" value={proof.mobile} readOnly hidden />
        <FormField label={isSignup ? "Password" : "New password"} htmlFor="password" error={errors.password?.message} required>
          <PasswordInput placeholder="Enter password" autoComplete="new-password" aria-describedby="password-rules" {...register("password")} />
        </FormField>
        <FormField label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message} required>
          <PasswordInput placeholder="Confirm password" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <ul id="password-rules" aria-label="Password rules" className="flex flex-col gap-1.5 text-sm">
          {rules.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-2", r.met ? "text-ink" : isSubmitted ? "text-error" : "text-ink-muted")}>
              {r.met ? (
                <Check aria-hidden="true" strokeWidth={2.25} className="size-4 shrink-0 text-green-600" />
              ) : (
                <Circle aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-ink-subtle" />
              )}
              <span>{r.label}</span>
              <span className="sr-only">{r.met ? "(met)" : "(not met)"}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-ink-muted">
            <Circle aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-ink-subtle" />
            Not your phone number
          </li>
        </ul>
        <p role="status" aria-live="polite" className="sr-only">
          {summary}
        </p>

        <FormAlert>{serviceError}</FormAlert>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={inviteMissing} className="mt-1">
          {isSignup ? (isSubmitting ? "Creating account…" : `Create ${ROLE_LABEL[role]} Account`) : isSubmitting ? "Saving…" : "Save Password"}
        </Button>
      </form>
    </>
  );
}
