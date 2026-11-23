"use client";

import { useState } from "react";
import { FileText, Star } from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, Skeleton, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyDriverDetailDTO } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatDate, formatPhone } from "@/lib/format";
import { RouteCard } from "@/features/driver-routes/RouteCard";
import { when } from "./format";
import { VERIFICATION, plural } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";

/** Driver detail (`/agency/drivers/[driverId]`): contact, masked documents, availability, assignments timeline, reviews. */
export function DriverDetailView({ driverId }: { driverId: string }) {
  const { state, reload, setData } = useApi(`driver:${driverId}`, () => agencyApi.driver(driverId));
  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading driver…</span>
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <PageHeader title="Driver" backHref={paths.agency.drivers()} backLabel="Back to drivers" />
        {state.code === "not_found" ? <EmptyState title="Driver not found" action={{ label: "Back to drivers", href: paths.agency.drivers() }} /> : <LoadError message={state.message} onRetry={reload} />}
      </>
    );
  }
  return <Detail d={state.data} onChange={setData} />;
}

function Detail({ d, onChange }: { d: AgencyDriverDetailDTO; onChange(d: AgencyDriverDetailDTO): void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const v = VERIFICATION[d.verification];
  const active = d.link.status === "active";

  async function toggleAvailability() {
    setBusy(true);
    try {
      const next = await agencyApi.setDriverAvailability(d.id, d.availability === "available" ? "unavailable" : "available");
      onChange({ ...d, ...next });
      toast({ title: next.availability === "available" ? "Marked available" : "Marked unavailable", tone: "success" });
    } catch (e) {
      toast({ title: "Couldn't update availability", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={d.fullName}
        backHref={paths.agency.drivers()}
        backLabel="Back to drivers"
        actions={
          active ? (
            <Button variant="outline" loading={busy} onClick={toggleAvailability}>
              {d.availability === "available" ? "Mark unavailable" : "Mark available"}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section" aria-label="Driver details">
            <div className="flex items-center gap-4">
              <Avatar name={d.fullName} src={d.photoUrl ?? undefined} size="lg" />
              <div className="min-w-0">
                <p className="font-heading text-lg font-semibold text-ink">{d.fullName}</p>
                <a href={`tel:${d.phone}`} className="text-sm text-green-700 underline-offset-4 hover:underline">
                  {formatPhone(d.phone)}
                </a>
                <p className="mt-1 flex flex-wrap gap-2">
                  <Badge tone={v.tone}>{d.verification === "verified" ? "Documents verified" : v.label}</Badge>
                  <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? "Available" : "Unavailable"}</Badge>
                  {!active ? <Badge tone="warning">{d.link.status}</Badge> : null}
                </p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-muted">Rating</dt>
              <dd className="flex items-center gap-1 text-ink">
                <Star aria-hidden="true" strokeWidth={1.75} className="size-4 text-star" />
                {d.stats.ratingCount ? `${d.stats.ratingAvg.toFixed(1)} (${d.stats.ratingCount})` : "No ratings yet"}
              </dd>
              <dt className="text-ink-muted">Deliveries</dt>
              <dd className="text-ink">{d.stats.delivered}</dd>
              <dt className="text-ink-muted">Joined via</dt>
              <dd className="text-ink">
                {d.link.via === "invite" ? "Your invite" : "Driver request"} · {when(d.link.decidedAt ?? d.link.requestedAt)}
              </dd>
            </dl>
          </Card>

          <Card as="section" aria-labelledby="docs-title">
            <h2 id="docs-title" className="type-h3 mb-3 text-ink">
              Documents
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              <DocRow label="Driving licence" number={d.license.numberMasked} url={d.license.fileUrl} extra={d.license.validUntil ? `valid until ${formatDate(d.license.validUntil)}` : null} />
              <DocRow label="Aadhaar" number={d.aadhaar.numberMasked} url={d.aadhaar.fileUrl} />
            </ul>
            <p className="mt-3 text-xs text-ink-subtle">Numbers are masked. Files open through TAKI&apos;s access-checked viewer.</p>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section" aria-labelledby="schedule-title">
            <h2 id="schedule-title" className="type-h3 mb-3 text-ink">
              Assignments
            </h2>
            {d.schedule.length === 0 ? (
              <p className="text-sm text-ink-muted">No upcoming assignments. This driver is free for new trips.</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm" data-testid="driver-schedule">
                {d.schedule.map((s) => (
                  <li key={s.tripId} className="rounded-md bg-surface-muted px-3 py-2 text-ink">
                    {when(s.from)} – {when(s.to)}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-xs text-ink-subtle">A driver can&apos;t be assigned to two trips whose times overlap.</p>
          </Card>

          <section aria-labelledby="driver-trips-title">
            <h2 id="driver-trips-title" className="type-h3 mb-3 text-ink">
              Trips ({d.trips.length})
            </h2>
            {d.trips.length === 0 ? (
              <p className="text-sm text-ink-muted">No trips yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {d.trips.map((t) => (
                  <li key={t.id}>
                    <RouteCard trip={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card as="section" aria-labelledby="reviews-title">
            <h2 id="reviews-title" className="type-h3 mb-3 text-ink">
              Reviews
            </h2>
            {d.reviews.length === 0 ? (
              <p className="text-sm text-ink-muted">No reviews yet.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {d.reviews.map((r) => (
                  <li key={r.id}>
                    <p className="font-semibold text-ink">
                      {"★".repeat(r.rating)}
                      <span className="sr-only">{r.rating} out of 5</span> · {r.customerFirstName}
                    </p>
                    {r.comment ? <p className="text-ink-muted">{r.comment}</p> : null}
                    <p className="text-xs text-ink-subtle">{when(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
            {d.reviews.length ? <p className="mt-2 text-xs text-ink-subtle">{plural(d.stats.ratingCount, "rating")} in total.</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function DocRow({ label, number, url, extra }: { label: string; number: string | null; url: string | null; extra?: string | null }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-ink">
        <FileText aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-600" />
        {label}
        <span className="text-ink-muted">{number ?? "Not uploaded"}</span>
        {extra ? <span className="text-ink-subtle">· {extra}</span> : null}
      </span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-green-700 underline-offset-4 hover:underline">
          View<span className="sr-only"> {label}</span>
        </a>
      ) : null}
    </li>
  );
}
