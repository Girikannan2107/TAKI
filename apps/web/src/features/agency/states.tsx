"use client";

import Link from "next/link";
import { CircleAlert, RotateCcw, ShieldAlert } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import type { VerificationStatus } from "@/lib/domain/model";
import { VERIFICATION } from "./labels";

/** Load-error card (P3 §3.0): plain message + "Try again". */
export function LoadError({ message, onRetry, title = "We couldn't load this", className }: { message: string; onRetry(): void; title?: string; className?: string }) {
  return (
    <Card role="alert" className={className}>
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0 text-error" />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-error">{message}</p>
          <Button variant="outline" size="sm" className="mt-3" leadingIcon={<RotateCcw aria-hidden="true" strokeWidth={2} />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Unverified-agency banner (P3 §3.0). Renders nothing when verified. */
export function VerificationBanner({ status, reason, id = "verification-banner", className }: { status: VerificationStatus; reason?: string | null; id?: string; className?: string }) {
  if (status === "verified") return null;
  const v = VERIFICATION[status];
  return (
    <Card tone="muted" padding="sm" className={className} data-testid="verification-banner">
      <div className="flex flex-wrap items-start gap-3 sm:items-center">
        <ShieldAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0 text-coral-700 sm:mt-0" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            <Badge tone={v.tone}>{v.label}</Badge>
          </p>
          <p id={id} className="mt-1 text-sm text-ink-muted">
            {status === "rejected"
              ? `TAKI couldn't verify your agency${reason ? `: ${reason}` : "."} Update your documents to publish trips and accept bookings.`
              : "You can add vehicles, drivers and draft trips now. Publishing trips and accepting bookings unlock once TAKI verifies your documents."}
          </p>
        </div>
        <Link
          href={paths.agency.verification()}
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
        >
          {status === "rejected" ? "Update documents" : "View documents"}
        </Link>
      </div>
    </Card>
  );
}
