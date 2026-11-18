"use client";

import { CircleAlert, CircleCheck, Clock3, RotateCcw, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, ButtonLink, Card, EmptyState, Skeleton } from "@/components/ui";
import type { AgencyProfileDTO, DriverProfileDTO } from "@/lib/api/contracts/auth";
import { dashboardFor, profileFor } from "@/lib/config/routes";
import { refreshSession } from "@/features/auth/session";
import { SignupStepper } from "@/features/auth/AuthBits";
import { AccountPhotoCard } from "./AccountPhotoCard";
import { DocumentsCard, verificationCopy } from "./DocumentsCard";
import { useProfile } from "./useProfile";

export interface VerificationViewProps {
  role: "agency" | "driver";
  /** Arrived straight from signup (`?onboarding=1`): shows the signup stepper and a "Go to dashboard" exit. */
  onboarding?: boolean;
}

/**
 * Post-signup documents + photo (P3 §4.2 step 4). Render it from /agency/profile/verification (D2) and
 * /driver/profile/documents (D4):
 *
 *   <VerificationView role="agency" onboarding={searchParams.onboarding === "1"} />
 */
export function VerificationView({ role, onboarding }: VerificationViewProps) {
  const { state, reload } = useProfile<AgencyProfileDTO | DriverProfileDTO>();
  const title = role === "agency" ? "Agency verification" : "Your documents";

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
        <span className="sr-only">Loading verification…</span>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" rounded="md" />
        <Skeleton className="h-48 w-full" rounded="md" />
        <Skeleton className="h-64 w-full" rounded="md" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title={title} />
        <EmptyState icon={<CircleAlert className="size-6" />} title="We couldn't load your details" description={state.message} action={{ label: "Try again", onClick: reload }} />
      </div>
    );
  }

  const p = state.profile;
  if (p.role !== role) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title={title} />
        <EmptyState icon={<ShieldAlert className="size-6" />} title="Not available for this account" action={{ label: "Go to dashboard", href: dashboardFor(p.role) }} />
      </div>
    );
  }

  const name = p.role === "agency" ? p.agencyName : p.fullName;
  const submitted = p.role === "agency" ? !!p.verification.submittedAt : p.documents.every((d) => d.status !== "missing") && !!p.photoUrl;
  const copy = verificationCopy(p.verification.status, submitted);
  const Icon = p.verification.status === "verified" ? CircleCheck : p.verification.status === "rejected" ? CircleAlert : Clock3;

  function changed() {
    reload();
    void refreshSession();
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader
        title={title}
        subtitle={
          role === "agency"
            ? "Verified agencies can publish trips. You can add vehicles and drivers while we review."
            : "Your agency assigns trips once your documents are verified and they've approved you."
        }
        backHref={onboarding ? undefined : profileFor(role)}
        backLabel="Back to profile"
      />
      {onboarding ? <SignupStepper role={role} current={3} /> : null}

      <div className="flex flex-col gap-6">
        <Card as="section" aria-labelledby="verification-status-title" tone={p.verification.status === "verified" ? "selected" : "default"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="verification-status-title" className="type-h3 text-ink">
                Verification status
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{copy.body}</p>
              {p.verification.status === "rejected" && p.verification.reason ? (
                <p className="mt-2 rounded-md bg-danger-100 px-3 py-2 text-sm text-error">
                  <span className="font-semibold">Reason:</span> {p.verification.reason}
                </p>
              ) : null}
            </div>
            <Badge tone={copy.tone} size="md" icon={<Icon aria-hidden="true" className="size-4" />}>
              {copy.title}
            </Badge>
          </div>
        </Card>

        <AccountPhotoCard
          name={name}
          photoUrl={p.photoUrl}
          onChanged={changed}
          required
          label={role === "agency" ? "Owner photo" : "Your photo"}
          description={role === "agency" ? "A clear photo of the agency owner." : "A clear face photo. Customers see it on their booking."}
        />
        <DocumentsCard role={role} documents={p.documents} onUploaded={changed} />

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          {onboarding ? (
            <ButtonLink href={dashboardFor(role)} variant={submitted ? "primary" : "ghost"} size="lg">
              {submitted ? "Go to dashboard" : "I'll do this later"}
            </ButtonLink>
          ) : (
            <ButtonLink href={profileFor(role)} variant="ghost" leadingIcon={<RotateCcw className="size-4" />}>
              Back to profile
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}
