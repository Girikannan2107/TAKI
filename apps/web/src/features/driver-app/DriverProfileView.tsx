"use client";

import { useState, type FormEvent } from "react";
import { Building2, ChevronRight, FileText, LogOut, Star } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useLogout } from "@/components/layout/useLogout";
import { Badge, Button, ButtonLink, FormField, Input, Rating, Skeleton, useToast, type BadgeTone } from "@/components/ui";
import { AccountPhotoCard, ChangePasswordCard, ChangePhoneCard, DOCUMENT_STATUS, verificationCopy } from "@/features/account";
import { refreshSession } from "@/features/auth/session";
import { DOCUMENT_LABELS } from "@/lib/api/contracts/auth";
import type { ReviewDTO } from "@/lib/api/contracts/common";
import type { DriverAppProfileDTO } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import type { DriverLinkStatus } from "@/lib/domain/model";
import { formatInstantDate, formatPhone } from "@/lib/format";
import { LoadError, Section } from "./parts";
import { useResource } from "./useResource";

const LINK_STATUS: Record<DriverLinkStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Approved", tone: "success" },
  pending: { label: "Approval pending", tone: "attention" },
  rejected: { label: "Declined", tone: "danger" },
  removed: { label: "Removed", tone: "danger" },
};

/** Driver profile (P3 §4.5): photo, details, agency, documents, rating + reviews, password, log out. */
export function DriverProfileView() {
  const { state, reload, replace } = useResource((signal) => driverApi.profile(signal), "profile");

  if (state.status === "loading") return <ProfileLoading />;
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title="Profile" />
        <LoadError message={state.message} onRetry={reload} />
      </div>
    );
  }
  return <Profile p={state.data} onChange={replace} reload={reload} />;
}

function Profile({ p, onChange, reload }: { p: DriverAppProfileDTO; onChange(v: DriverAppProfileDTO): void; reload(): void }) {
  const logout = useLogout();
  const a = p.account;
  const link = a.agencyLink;
  const submitted = a.documents.every((d) => d.status !== "missing") && !!a.photoUrl;
  const verify = verificationCopy(a.verification.status, submitted);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <PageHeader title="Profile" subtitle={`Driver since ${formatInstantDate(a.createdAt)}`} className="mb-0 lg:mb-2" />

      <AccountPhotoCard name={a.fullName} photoUrl={a.photoUrl} required description="Your agency and customers see this photo on your trips." onChanged={() => reload()} />

      <DetailsCard p={p} onChange={onChange} />

      <Section id="agency" title="Agency">
        {link ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 font-medium text-ink">
              <Building2 aria-hidden="true" className="size-4 shrink-0 text-green-700" />
              <span className="truncate">{link.agencyName}</span>
            </p>
            <Badge tone={LINK_STATUS[link.status].tone}>{LINK_STATUS[link.status].label}</Badge>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">You haven&apos;t joined an agency yet.</p>
        )}
        {link?.status !== "active" ? (
          <ButtonLink href={paths.driver.dashboard} variant="outline" size="sm" className="self-start">
            {link?.status === "pending" ? "View request status" : "Choose an agency"}
          </ButtonLink>
        ) : null}
      </Section>

      <Section
        id="documents"
        title="Documents"
        action={<Badge tone={verify.tone}>{verify.title}</Badge>}
      >
        <p className="text-sm text-ink-muted">{a.verification.status === "rejected" && a.verification.reason ? `${verify.body} Reason: ${a.verification.reason}` : verify.body}</p>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {a.documents.map((d) => (
            <li key={d.kind} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{DOCUMENT_LABELS[d.kind]}</span>
                <span className="block font-mono text-[13px] tabular-nums text-ink-muted">{d.numberMasked ?? "Not uploaded"}</span>
              </span>
              <Badge tone={DOCUMENT_STATUS[d.status].tone}>{DOCUMENT_STATUS[d.status].label}</Badge>
            </li>
          ))}
        </ul>
        <ButtonLink href={paths.driver.documents()} variant="outline" size="sm" className="self-start" leadingIcon={<FileText aria-hidden="true" className="size-4" />} trailingIcon={<ChevronRight aria-hidden="true" className="size-4" />}>
          Manage documents
        </ButtonLink>
      </Section>

      <ReviewsCard stats={a.stats} reviews={p.reviews} />

      <ChangePhoneCard phoneMasked={a.phoneMasked} onChanged={() => reload()} />
      <ChangePasswordCard />

      <Button variant="outline" onClick={() => logout()} leadingIcon={<LogOut aria-hidden="true" className="size-4" />} className="self-start">
        Log out
      </Button>
    </div>
  );
}

function DetailsCard({ p, onChange }: { p: DriverAppProfileDTO; onChange(v: DriverAppProfileDTO): void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.account.fullName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (v.length < 2) {
      setError("Enter your full name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await driverApi.updateProfile(v);
      onChange(next);
      setEditing(false);
      void refreshSession();
      toast({ title: "Name updated", tone: "success" });
    } catch (err) {
      if (isApiError(err) && err.fields?.fullName) setError(err.fields.fullName);
      else toast({ title: "Name not saved", description: errorMessage(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="details"
      title="Your details"
      action={
        editing ? null : (
          <Button variant="ghost" size="sm" onClick={() => { setName(p.account.fullName); setEditing(true); }}>
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-3">
          <FormField label="Full name" htmlFor="driver-name" error={error ?? undefined} required>
            <Input id="driver-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" invalid={!!error} disabled={busy} autoFocus />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-ink-muted">Full name</dt>
            <dd className="font-semibold text-ink">{p.account.fullName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-muted">Mobile</dt>
            <dd className="font-semibold tabular-nums text-ink">{formatPhone(p.account.phone)}</dd>
          </div>
        </dl>
      )}
    </Section>
  );
}

function ReviewsCard({ stats, reviews }: { stats: DriverAppProfileDTO["account"]["stats"]; reviews: ReviewDTO[] }) {
  return (
    <Section id="reviews" title="Ratings and reviews">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {stats.ratingCount > 0 ? <Rating value={stats.ratingAvg} count={stats.ratingCount} countLabel={stats.ratingCount === 1 ? "rating" : "ratings"} /> : <p className="text-sm text-ink-muted">No ratings yet</p>}
        <p className="text-sm text-ink-muted">
          <span className="font-semibold tabular-nums text-ink">{stats.delivered}</span> {stats.delivered === 1 ? "delivery" : "deliveries"}
        </p>
      </div>
      {reviews.length === 0 ? (
        <p className="text-sm text-ink-muted">Customers can rate you after a delivery. Their reviews will appear here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1" aria-label={`${r.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} aria-hidden="true" strokeWidth={1.5} className={i < r.rating ? "size-4 fill-star text-star" : "size-4 text-border-strong"} />
                  ))}
                </span>
                <span className="text-[13px] tabular-nums text-ink-muted">{formatInstantDate(r.createdAt)}</span>
              </div>
              {r.comment ? <p className="break-words text-sm text-ink">{r.comment}</p> : null}
              <p className="text-[13px] text-ink-muted">
                {r.customerFirstName} · <span className="font-mono tabular-nums">{r.bookingId}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProfileLoading() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <span className="sr-only">Loading your profile…</span>
      <Skeleton className="h-9 w-40" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full" rounded="md" />
      ))}
    </div>
  );
}
