"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { Badge, Card, EmptyState, Skeleton, type BadgeTone } from "@/components/ui";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import { PAYMENT_STATUS_LABEL } from "@/lib/domain/labels";
import type { Booking, Payment, PaymentStatus } from "@/lib/domain/types";
import { formatDateTime, formatINR, formatInstantDate } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useCustomerPayments } from "@/lib/store/selectors";

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  succeeded: "paid",
  failed: "danger",
  refunded: "info",
  initiated: "warning",
};

const SHORT_METHOD: Record<Payment["method"], string> = { upi: "UPI", card: "Card", netbanking: "Net Banking" };

/** `/customer/payments` — the customer's (demo) payment history. */
export function PaymentsView() {
  const hydrated = useHydrated();
  const rows = useCustomerPayments();
  const header = <PageHeader title="Payments" subtitle="Your demo payments and refunds. No money moves in this demo." />;

  if (!hydrated) {
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

  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Wallet strokeWidth={1.75} />}
          title="No payments yet"
          description="Payments for your bookings will appear here."
          action={{ label: "Find Available Vehicles", href: paths.customer.dashboard }}
        />
      </>
    );
  }

  const totalPaid = rows.reduce((sum, r) => (r.payment.status === "succeeded" ? sum + r.payment.amount : sum), 0);
  const paidCount = rows.filter((r) => r.payment.status === "succeeded").length;

  return (
    <>
      {header}
      <div className="mb-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:mb-6">
        <Card padding="sm" className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-6"
          >
            <Wallet strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">Total paid (demo)</p>
            <p className="type-amount-md text-price" data-testid="payments-total">
              {formatINR(totalPaid)}
            </p>
            <p className="text-caption text-ink-subtle">
              {paidCount} {paidCount === 1 ? "payment" : "payments"}, excluding refunds
            </p>
          </div>
        </Card>
        <DemoBanner kind="payment" className="self-stretch">
          These payments were simulated. No card or bank details were collected.
        </DemoBanner>
      </div>

      {/* Desktop / tablet: table (scrolls inside its own container if ever too narrow) */}
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
              {rows.map(({ payment, booking }) => (
                <tr key={payment.id} data-testid="payment-row" data-booking-id={payment.bookingId} className="align-middle">
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDateTime(payment.createdAt)}</td>
                  <td className="px-4 py-3">
                    <BookingLink id={payment.bookingId} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{routeText(booking)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{SHORT_METHOD[payment.method]}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">{formatINR(payment.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusBadges payment={payment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile: cards */}
      <ul className="flex flex-col gap-3 md:hidden" aria-label="Payment history, newest first">
        {rows.map(({ payment, booking }) => (
          <Card as="li" key={payment.id} padding="sm" data-testid="payment-card" data-booking-id={payment.bookingId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <BookingLink id={payment.bookingId} />
                <p className="mt-0.5 text-sm text-ink-muted">{routeText(booking)}</p>
              </div>
              <p className="shrink-0 font-heading text-base font-semibold tabular-nums text-ink">{formatINR(payment.amount)}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption text-ink-muted">
                {formatInstantDate(payment.createdAt)} · {SHORT_METHOD[payment.method]}
              </p>
              <StatusBadges payment={payment} />
            </div>
          </Card>
        ))}
      </ul>
    </>
  );
}

function routeText(booking: Booking | undefined): string {
  return booking ? `${cityName(booking.shipment.sourceCityId)} → ${cityName(booking.shipment.destinationCityId)}` : "—";
}

function BookingLink({ id }: { id: string }) {
  return (
    <Link
      href={paths.customer.tracking(id)}
      className="inline-flex min-h-11 items-center font-heading font-semibold tabular-nums text-green-700 underline-offset-4 hover:text-green-500 hover:underline md:min-h-0 pointer-coarse:min-h-11"
    >
      <span className="sr-only">Track booking </span>
      {id}
    </Link>
  );
}

function StatusBadges({ payment }: { payment: Payment }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONE[payment.status]}>{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
      {payment.mode === "demo" ? <Badge tone="neutral">Demo</Badge> : null}
    </span>
  );
}
