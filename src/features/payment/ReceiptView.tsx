"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { Printer, ReceiptText } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState } from "@/components/ui";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { BookingSummary } from "@/features/booking/BookingSummary";
import { BookingIdCopy } from "@/features/tracking/BookingIdCopy";
import { settledPayment, shipmentPath, useOwnedBooking } from "@/features/tracking/booking-access";
import { paths } from "@/lib/config/routes";
import { reachedAt } from "@/lib/domain/booking-machine";
import { cargoLabel, customerStatusLabel, paymentMethodLabel, statusTone } from "@/lib/domain/labels";
import { getVehicleModel } from "@/lib/domain/vehicles";
import { formatDate, formatDateTime, formatINR, formatKg, routeLabel } from "@/lib/format";
import { ConfirmationSkeleton } from "./BookingConfirmationView";

/** `/customer/receipt/[bookingId]` — final step of the customer flow, available once the shipment is delivered. */
export function ReceiptView() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ? decodeURIComponent(params.bookingId) : null;
  const { ready, details } = useOwnedBooking(bookingId);
  const header = (
    <PageHeader
      title="Receipt"
      backHref={bookingId ? paths.customer.tracking(bookingId) : paths.customer.shipments}
      backLabel="Back to tracking"
    />
  );

  if (!ready) return <ConfirmationSkeleton />;

  const payment = details ? settledPayment(details.payments) : undefined;
  if (!details || !payment || details.booking.status !== "delivered") {
    return (
      <>
        {header}
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title={details ? "Receipt not ready yet" : "Booking not found"}
          description={
            details
              ? "The receipt is available once the shipment has been delivered and verified."
              : "We couldn't find this booking on your account."
          }
          action={
            details
              ? { label: "Track shipment", href: paths.customer.tracking(details.booking.id) }
              : { label: "View my shipments", href: paths.customer.shipments }
          }
        />
      </>
    );
  }

  const { booking, route, vehicle, driver } = details;
  const provider = driver?.businessName ?? "Transport provider";
  const vehicleLabel = vehicle ? (getVehicleModel(vehicle.modelId)?.label ?? vehicle.modelId) : null;
  const pickedUpAt = reachedAt(booking, "picked_up");
  const deliveredAt = reachedAt(booking, "delivered");

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
              <BookingIdCopy bookingId={booking.id} className="mt-2" />
            </div>
            <Badge tone={statusTone(booking.status)} size="md">
              {customerStatusLabel(booking.status)}
            </Badge>
          </div>

          <dl className="mt-6 divide-y divide-border rounded-md border border-border text-sm sm:text-base" data-testid="receipt-details">
            <Row term="Route" value={routeLabel(shipmentPath(booking, route))} />
            <Row term="Pickup date" value={formatDate(booking.shipment.pickupDate)} />
            {pickedUpAt ? <Row term="Picked up" value={formatDateTime(pickedUpAt)} /> : null}
            {deliveredAt ? <Row term="Delivered" value={formatDateTime(deliveredAt)} /> : null}
            <Row term="Weight" value={formatKg(booking.shipment.weightKg)} />
            {booking.shipment.cargoType ? <Row term="Cargo type" value={cargoLabel(booking.shipment.cargoType)} /> : null}
            <Row term="Vehicle" value={vehicleLabel ? `${provider} · ${vehicleLabel}` : provider} />
            <Row term="Payment method" value={paymentMethodLabel(payment.method)} />
            <Row
              term="Amount paid"
              value={
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="font-semibold tabular-nums text-price" data-testid="receipt-amount">
                    {formatINR(payment.amount)}
                  </span>
                  {payment.mode === "demo" ? <Badge tone="paid">Demo payment</Badge> : null}
                </span>
              }
            />
          </dl>

          <BookingSummary pricing={booking.pricing} title="Price breakdown" className="mt-5" />

          {payment.mode === "demo" ? (
            <DemoBanner kind="payment" className="mt-5">
              Demo receipt. No money moved and this is not a tax invoice.
            </DemoBanner>
          ) : null}

          <div className="mt-6 grid gap-3 print:hidden sm:grid-cols-2">
            <Button
              variant="outline"
              fullWidth
              onClick={() => window.print()}
              leadingIcon={<Printer aria-hidden="true" strokeWidth={1.75} />}
            >
              Print receipt
            </Button>
            <ButtonLink href={paths.customer.dashboard} fullWidth>
              Book another shipment
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
