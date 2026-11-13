"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Circle, CircleCheck, Lock } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyBookingDTO } from "@/lib/api/contracts/agency";
import { paths } from "@/lib/config/routes";
import { STATE_NAMES } from "@/lib/domain/model";
import { formatDate, formatINR, formatKg, formatPhone, formatRate } from "@/lib/format";
import { AcceptBookingDialog, RejectBookingModal } from "./BookingDecision";
import { when } from "./format";
import { BOOKING_STATUS, GOODS_LABEL, HANDLING_LABEL, PAYMENT_STATUS, TIMELINE_LABEL } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";

/** Booking details (`/agency/bookings/[bookingId]`, P3 §4.4). Contact details appear only once the status allows it (server-projected). */
export function BookingDetailsView({ bookingId }: { bookingId: string }) {
  const { state, reload, setData } = useApi(`booking:${bookingId}`, () => agencyApi.booking(bookingId));
  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading booking…</span>
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <PageHeader title="Booking" backHref={paths.agency.bookings()} backLabel="Back to bookings" />
        {state.code === "not_found" ? (
          <EmptyState title="Booking not found" description="It may belong to another agency." action={{ label: "Back to bookings", href: paths.agency.bookings() }} />
        ) : (
          <LoadError message={state.message} onRetry={reload} />
        )}
      </>
    );
  }
  return <Details b={state.data} onChange={setData} onStale={reload} />;
}

function Details({ b, onChange, onStale }: { b: AgencyBookingDTO; onChange(b: AgencyBookingDTO): void; onStale(): void }) {
  const [modal, setModal] = useState<null | "accept" | "reject">(null);
  const status = BOOKING_STATUS[b.status];
  const pending = b.status === "awaiting_agency";
  const hidden = <Hidden />;

  return (
    <>
      <PageHeader
        title={`Booking ${b.id}`}
        backHref={paths.agency.bookings(b.tab)}
        backLabel="Back to bookings"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} size="md">
              {status.label}
            </Badge>
            <span>Requested {when(b.createdAt)}</span>
          </span>
        }
        actions={
          pending ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setModal("reject")}>
                Reject
              </Button>
              <Button onClick={() => setModal("accept")}>Accept</Button>
            </div>
          ) : undefined
        }
      />

      {b.rejection ? (
        <Notice>
          Rejected {when(b.rejection.at)}
          {b.rejection.note ? `: ${b.rejection.note}` : ""}
        </Notice>
      ) : null}
      {b.cancellation ? (
        <Notice>
          Cancelled {when(b.cancellation.at)}: {b.cancellation.reason}
          {b.cancellation.note ? ` — ${b.cancellation.note}` : ""}
        </Notice>
      ) : null}
      {pending ? (
        <Notice>
          Respond by {when(b.respondBy)}.{b.capacity ? ` ${formatKg(b.capacity.availableKg)} left on this trip; ${formatKg(Math.max(0, b.capacity.afterAcceptKg))} after accepting.` : ""}
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Customer & receiver">
            <Rows
              rows={[
                ["Customer", b.customer.name],
                ["Customer phone", b.customer.phone ? <a className="text-green-700 underline-offset-4 hover:underline" href={`tel:${b.customer.phone}`}>{formatPhone(b.customer.phone)}</a> : hidden],
                ["Receiver", b.receiver ? b.receiver.name : hidden],
                ["Receiver phone", b.receiver ? <a className="text-green-700 underline-offset-4 hover:underline" href={`tel:${b.receiver.phone}`}>{formatPhone(b.receiver.phone)}</a> : hidden],
              ]}
            />
            {b.sharedWithDriver && b.trip ? <p className="mt-3 text-sm text-ink-muted">Customer & receiver details are shared with {b.trip.driverName}.</p> : null}
          </Section>

          <Section title="Pickup & drop">
            <Rows
              rows={[
                ["Pickup", `${b.pickup.placeName} · ${b.addresses.pickup.districtName}, ${STATE_NAMES[b.addresses.pickup.state]}`],
                ["Pickup address", b.addresses.pickup.line ? `${b.addresses.pickup.line}${b.addresses.pickup.pincode ? ` – ${b.addresses.pickup.pincode}` : ""}` : hidden],
                ["Drop", `${b.drop.placeName} · ${b.addresses.drop.districtName}, ${STATE_NAMES[b.addresses.drop.state]}`],
                ["Drop address", b.addresses.drop.line ? `${b.addresses.drop.line}${b.addresses.drop.pincode ? ` – ${b.addresses.drop.pincode}` : ""}` : hidden],
                ["Shipping date", formatDate(b.shippingDate)],
              ]}
            />
          </Section>

          <Section title="Package">
            <Rows
              rows={[
                ["Weight", formatKg(b.package.weightKg)],
                ["Goods", GOODS_LABEL[b.package.goodsCategory]],
                ["Type", `${b.package.packageType}${b.package.pieces > 1 ? ` × ${b.package.pieces}` : ""}`],
                ["Description", b.package.description || "—"],
                ["Special handling", b.package.specialHandling.length ? b.package.specialHandling.map((h) => HANDLING_LABEL[h]).join(", ") : "None"],
                ["Declared value", b.package.declaredValueRupees !== null ? formatINR(b.package.declaredValueRupees) : "—"],
              ]}
            />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {b.trip ? (
            <Section title="Trip">
              <Link href={paths.agency.trip(b.trip.id)} className="font-semibold text-green-700 underline-offset-4 hover:underline">
                {b.trip.routeLabel}
              </Link>
              <Rows
                className="mt-2"
                rows={[
                  ["Departs", when(b.trip.departureAt)],
                  ["Vehicle", b.trip.vehicleReg],
                  ["Driver", b.trip.driverName],
                ]}
              />
            </Section>
          ) : null}

          <Section title="Price">
            <Rows
              rows={[
                [`Distance (${b.pricing.distanceKm} km × ${formatRate(b.pricing.ratePerKmPaise)})`, formatINR(b.pricing.distanceCharge)],
                [`Weight (${formatKg(b.pricing.weightKg)} × ${formatRate(b.pricing.ratePerKgPaise)})`, formatINR(b.pricing.weightCharge)],
                ["Handling fee", formatINR(b.pricing.handlingFee)],
                ["TAKI service fee", formatINR(b.pricing.serviceFee)],
                ["Customer pays", <strong key="t">{formatINR(b.pricing.totalPayable)}</strong>],
                ["Your earnings", <strong key="e" className="text-green-700">{formatINR(b.earnings)}</strong>],
              ]}
            />
            {b.payment ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink">
                Payment: <Badge tone={PAYMENT_STATUS[b.payment.status].tone}>{PAYMENT_STATUS[b.payment.status].label}</Badge>
                {b.payment.methodLabel ? <span className="text-ink-muted">{b.payment.methodLabel}</span> : null}
                {b.payment.paidAt ? <span className="text-ink-muted">· {when(b.payment.paidAt)}</span> : null}
              </p>
            ) : b.paymentDueAt ? (
              <p className="mt-3 text-sm text-ink-muted">Payment due by {when(b.paymentDueAt)}.</p>
            ) : null}
          </Section>

          <Section title="Timeline">
            {b.timeline.length === 0 ? (
              <p className="text-sm text-ink-muted">No events yet.</p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="booking-timeline">
                {b.timeline.map((t, i) => (
                  <li key={`${t.type}-${t.at}-${i}`} className="flex gap-3">
                    {i === b.timeline.length - 1 ? (
                      <CircleCheck aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0 text-green-600" />
                    ) : (
                      <Circle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0 text-green-500" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {TIMELINE_LABEL[t.type]}
                        {t.placeName ? <span className="font-normal text-ink-muted"> · {t.placeName}</span> : null}
                      </p>
                      <p className="text-sm text-ink-muted">{when(t.at)}</p>
                      {t.remarks ? <p className="mt-0.5 text-sm text-ink">{t.remarks}</p> : null}
                      {t.proofUrls.length ? (
                        <p className="mt-1 flex flex-wrap gap-2 text-sm">
                          {t.proofUrls.map((u, k) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="font-semibold text-green-700 underline-offset-4 hover:underline">
                              Delivery proof {k + 1}
                            </a>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>

      <AcceptBookingDialog
        booking={modal === "accept" ? b : null}
        onClose={() => setModal(null)}
        onStale={onStale}
        onDone={(nb) => {
          setModal(null);
          onChange(nb);
        }}
      />
      <RejectBookingModal
        booking={modal === "reject" ? b : null}
        onClose={() => setModal(null)}
        onDone={(nb) => {
          setModal(null);
          onChange(nb);
        }}
      />
    </>
  );
}

function Hidden() {
  return (
    <span className="inline-flex items-center gap-1 text-ink-subtle">
      <Lock aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      Shared after you accept
    </span>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <Card tone="muted" padding="sm" className="mb-5">
      <p className="text-sm text-ink">{children}</p>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <Card as="section" aria-labelledby={id}>
      <h2 id={id} className="type-h3 mb-3 text-ink">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Rows({ rows, className }: { rows: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-4 gap-y-2 text-sm ${className ?? ""}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
