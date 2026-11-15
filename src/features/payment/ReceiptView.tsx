"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { Printer, ReceiptText } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { customerApi } from "@/lib/api/client/customer";
import { paths } from "@/lib/config/routes";
import { formatDateTime, formatINR, formatKg } from "@/lib/format";
import { BookingSummary } from "@/features/booking/BookingSummary";
import { GOODS_LABEL, bookingStatusLabel, bookingStatusTone } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import { BookingIdCopy } from "@/features/tracking/BookingIdCopy";
import { ConfirmationSkeleton } from "./BookingConfirmationView";

/** `/customer/receipt/[bookingId]` — available once the shipment is delivered. */
export function ReceiptView() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ? decodeURIComponent(params.bookingId) : "";
  const booking = useApi(bookingId ? `customer:booking:${bookingId}` : null, (signal) => customerApi.booking(bookingId, signal));
  const header = <PageHeader title="Receipt" backHref={bookingId ? paths.customer.tracking(bookingId) : paths.customer.shipments} backLabel="Back to shipment details" />;

  if (booking.loading) return <ConfirmationSkeleton />;
  if (booking.error && !isNotFound(booking.error)) {
    return (
      <>
        {header}
        <LoadError error={booking.error} title="We couldn't load this receipt" onRetry={() => void booking.reload()} />
      </>
    );
  }
  const b = booking.data;
  if (!b || b.status !== "delivered" || !b.payment) {
    return (
      <>
        {header}
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title={b ? "Receipt not ready yet" : "Booking not found"}
          description={b ? "The receipt is available once the shipment has been delivered." : "We couldn't find this booking on your account."}
          action={b ? { label: "Shipment details", href: paths.customer.tracking(b.id) } : { label: "View my shipments", href: paths.customer.shipments }}
        />
      </>
    );
  }

  const at = (s: string) => b.statusHistory.find((h) => h.status === s)?.at;
  const pickedUpAt = at("picked_up");
  const deliveredAt = at("delivered");

  return (
    <>
      {header}
      <div className="mx-auto max-w-[720px]">
        <Card as="section" aria-labelledby="receipt-heading" padding="lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="receipt-heading" className="type-h3 text-ink">
                Delivery receipt
              </h2>
              <BookingIdCopy bookingId={b.id} className="mt-2" />
            </div>
            <Badge tone={bookingStatusTone(b.status)} size="md">
              {bookingStatusLabel(b.status)}
            </Badge>
          </div>

          <dl className="mt-6 divide-y divide-border rounded-md border border-border text-sm sm:text-base" data-testid="receipt-details">
            <Row term="Route" value={`${b.trip.pickup.placeName} → ${b.trip.drop.placeName}`} />
            {pickedUpAt ? <Row term="Picked up" value={formatDateTime(pickedUpAt)} /> : null}
            {deliveredAt ? <Row term="Delivered" value={formatDateTime(deliveredAt)} /> : null}
            <Row term="Weight" value={formatKg(b.shipment.package.weightKg)} />
            <Row term="Goods" value={GOODS_LABEL[b.shipment.package.goodsCategory]} />
            <Row term="Receiver" value={b.shipment.receiver.name} />
            <Row term="Agency" value={`${b.trip.agency.name} · ${b.trip.vehicle.vehicleClass}`} />
            {b.payment.methodLabel ? <Row term="Payment method" value={b.payment.methodLabel} /> : null}
            <Row
              term="Amount paid"
              value={
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="font-semibold tabular-nums text-price" data-testid="receipt-amount">
                    {formatINR(b.payment.amountRupees)}
                  </span>
                  {b.payment.provider === "dev" ? <Badge tone="paid">Test payment</Badge> : null}
                </span>
              }
            />
          </dl>

          <BookingSummary pricing={b.pricing} title="Price breakdown" className="mt-5" />
          <p className="mt-3 text-caption text-ink-subtle">This receipt is not a tax invoice.</p>

          <div className="mt-6 grid gap-3 print:hidden sm:grid-cols-2">
            <Button variant="outline" fullWidth onClick={() => window.print()} leadingIcon={<Printer aria-hidden="true" strokeWidth={1.75} />}>
              Print receipt
            </Button>
            <ButtonLink href={paths.customer.newShipment()} fullWidth>
              Ship something else
            </ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}

function Row({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 font-medium text-ink sm:text-right">{value}</dd>
    </div>
  );
}
