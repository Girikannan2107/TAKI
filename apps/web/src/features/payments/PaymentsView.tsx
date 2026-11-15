"use client";

import Link from "next/link";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, type BadgeTone } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { customerApi } from "@/lib/api/client/customer";
import type { PaymentHistoryItem } from "@/lib/api/contracts/customer";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatDateTime, formatINR, formatInstantDate } from "@/lib/format";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { useApi } from "@/features/customer-shipment/use-api";

const STATUS: Record<PaymentHistoryItem["status"], { label: string; tone: BadgeTone }> = {
  created: { label: "Started", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  succeeded: { label: "Paid", tone: "paid" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refund_pending: { label: "Refund in progress", tone: "info" },
  refunded: { label: "Refunded", tone: "info" },
  refund_failed: { label: "Refund delayed", tone: "danger" },
};

const PAGE_SIZE = 20;

/** `/customer/payments` — payment history (newest first), reached from Profile and receipts. */
export function PaymentsView() {
  const first = useApi("customer:payments", (signal) => customerApi.payments({ limit: PAGE_SIZE }, signal));
  const [more, setMore] = useState<{ items: PaymentHistoryItem[]; cursor: string | null }>({ items: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const header = <PageHeader title="Payments" subtitle="Your payments and refunds." backHref={paths.customer.profile} backLabel="Back to profile" />;

  if (first.loading) {
    return (
      <>
        {header}
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">Loading payments…</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }
  if (first.error || !first.data) {
    return (
      <>
        {header}
        <LoadError error={first.error} title="We couldn't load your payments" onRetry={() => void first.reload()} />
      </>
    );
  }

  const rows = [...first.data.items, ...more.items];
  const cursor = more.items.length ? more.cursor : first.data.nextCursor;
  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Wallet strokeWidth={1.75} />}
          title="No payments yet"
          description="Payments for your accepted bookings will appear here."
          action={{ label: "My Shipments", href: paths.customer.shipments }}
        />
      </>
    );
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await customerApi.payments({ cursor, limit: PAGE_SIZE });
      setMore((m) => ({ items: [...m.items, ...page.items], cursor: page.nextCursor }));
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const paid = rows.filter((r) => r.status === "succeeded");
  const totalPaid = paid.reduce((sum, r) => sum + r.amountRupees, 0);

  return (
    <>
      {header}
      <Card padding="sm" className="mb-5 flex items-center gap-4 lg:mb-6 sm:max-w-sm">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-6">
          <Wallet strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">Total paid</p>
          <p className="type-amount-md text-price" data-testid="payments-total">
            {formatINR(totalPaid)}
          </p>
          <p className="text-caption text-ink-subtle">
            {paid.length} {paid.length === 1 ? "payment" : "payments"} shown, excluding refunds
          </p>
        </div>
      </Card>

      <Card padding="none" className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Payment history, newest first</caption>
            <thead className="border-b border-border bg-surface-muted text-caption uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                <th scope="col" className="px-4 py-3 font-semibold">Booking ID</th>
                <th scope="col" className="px-4 py-3 font-semibold">Route</th>
                <th scope="col" className="px-4 py-3 font-semibold">Method</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.id} data-testid="payment-row" data-booking-id={p.bookingId} className="align-middle">
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDateTime(p.createdAt)}</td>
                  <td className="px-4 py-3">
                    <BookingLink id={p.bookingId} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{p.routeLabel ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{p.methodLabel ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">{formatINR(p.amountRupees)}</td>
                  <td className="px-4 py-3">
                    <StatusBadges p={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ul className="flex flex-col gap-3 md:hidden" aria-label="Payment history, newest first">
        {rows.map((p) => (
          <Card as="li" key={p.id} padding="sm" data-testid="payment-card" data-booking-id={p.bookingId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <BookingLink id={p.bookingId} />
                <p className="mt-0.5 text-sm text-ink-muted">{p.routeLabel ?? "—"}</p>
              </div>
              <p className="shrink-0 font-heading text-base font-semibold tabular-nums text-ink">{formatINR(p.amountRupees)}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption text-ink-muted">
                {formatInstantDate(p.createdAt)}
                {p.methodLabel ? ` · ${p.methodLabel}` : ""}
              </p>
              <StatusBadges p={p} />
            </div>
          </Card>
        ))}
      </ul>

      {cursor ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={() => void loadMore()} loading={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
          {moreError ? (
            <p role="alert" className="text-sm text-error">
              {moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function BookingLink({ id }: { id: string }) {
  return (
    <Link
      href={paths.customer.tracking(id)}
      className="inline-flex min-h-11 items-center font-heading font-semibold tabular-nums text-green-700 underline-offset-4 hover:text-green-500 hover:underline md:min-h-0 pointer-coarse:min-h-11"
    >
      <span className="sr-only">Shipment </span>
      {id}
    </Link>
  );
}

function StatusBadges({ p }: { p: PaymentHistoryItem }) {
  const s = STATUS[p.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={s.tone}>{s.label}</Badge>
      {p.refund ? <Badge tone="info">{`Refund ${formatINR(p.refund.amountRupees)}`}</Badge> : null}
      {p.provider === "dev" ? <Badge tone="neutral">Test</Badge> : null}
    </span>
  );
}
