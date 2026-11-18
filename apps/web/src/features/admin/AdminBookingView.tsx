"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, DataList, EmptyState } from "@/components/ui";
import { adminApi } from "@/lib/api/client/admin";
import { paths } from "@/lib/config/routes";
import { formatINR, formatInstantDate } from "@/lib/format";
import { ListSkeleton, LoadError, useLoad } from "./AdminBits";
import { StatusBadge, refundText } from "./AdminPaymentsView";

const humanize = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : "—");

/**
 * /admin/bookings/[bookingId] (M7): support lookup — the four booking state fields, parties, every payment
 * attempt with its refund, and the event history. Read-only.
 */
export function AdminBookingView() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { state, reload } = useLoad(() => adminApi.booking(bookingId), `booking:${bookingId}`);
  const header = <PageHeader title={`Booking ${bookingId}`} backHref={paths.admin.payments()} backLabel="Back to payments" />;

  if (state.status === "loading")
    return (
      <>
        {header}
        <ListSkeleton rows={3} label="Loading booking" />
      </>
    );
  if (state.status === "error")
    return (
      <>
        {header}
        <LoadError message={state.message} onRetry={reload} />
      </>
    );

  const b = state.data;
  const s = b.state;
  return (
    <>
      {header}
      <div className="flex flex-col gap-5">
        <Card as="section" aria-labelledby="bk-state">
          <h2 id="bk-state" className="type-h3 text-ink">
            Status
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <Item term="Booking" value={humanize(b.status)} />
            <Item term="Approval" value={humanize(s?.approvalStatus)} />
            <Item term="Payment" value={humanize(s?.paymentStatus)} />
            <Item term="Capacity" value={humanize(s?.reservationStatus)} />
            <Item term="Fulfilment" value={humanize(s?.fulfilmentStatus)} />
            <Item term="Closed" value={s?.closure ? `${humanize(s.closure.kind)}${s.closure.reason ? ` — ${s.closure.reason}` : ""}` : "—"} />
            <Item term="Customer" value={b.customer ? `${b.customer.name}${b.customer.phoneMasked ? ` (${b.customer.phoneMasked})` : ""}` : "—"} />
            <Item term="Agency" value={b.agency?.name ?? "—"} />
            <Item term="Route" value={b.routeLabel ?? "—"} />
            <Item term="Total" value={typeof b.totalPayable === "number" ? formatINR(b.totalPayable) : "—"} />
            <Item term="Created" value={formatInstantDate(b.createdAt)} />
          </dl>
        </Card>

        <section aria-labelledby="bk-payments">
          <h2 id="bk-payments" className="type-h3 mb-3 text-ink">
            Payments
          </h2>
          <DataList
            label="Payment attempts"
            rows={b.payments}
            rowKey={(p) => p.id}
            empty={<EmptyState title="No payment attempts" description="The customer hasn't started a payment for this booking." />}
            columns={[
              { id: "id", header: "Payment", cell: (p) => <span className="tabular-nums">{p.id}</span> },
              { id: "amount", header: "Amount", align: "right", cell: (p) => formatINR(p.amountRupees) },
              { id: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
              { id: "cf", header: "Cashfree", cell: (p) => p.cfOrderStatus ?? "—" },
              { id: "refund", header: "Refund", cell: (p) => refundText(p) },
              { id: "at", header: "Created", cell: (p) => formatInstantDate(p.createdAt) },
            ]}
          />
        </section>

        <Card as="section" aria-labelledby="bk-events">
          <h2 id="bk-events" className="type-h3 text-ink">
            History
          </h2>
          {b.events.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No events recorded.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2 text-sm">
              {b.events.map((e, i) => (
                <li key={`${e.type}-${i}`} className="flex flex-wrap gap-x-3">
                  <span className="tabular-nums text-ink-muted">{formatInstantDate(e.at)}</span>
                  <span className="font-medium text-ink">{humanize(e.type)}</span>
                  {e.byRole ? <span className="text-ink-muted">by {e.byRole}</span> : null}
                  {e.note ? <span className="text-ink-muted">— {e.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="break-words font-medium text-ink">{value}</dd>
    </div>
  );
}
