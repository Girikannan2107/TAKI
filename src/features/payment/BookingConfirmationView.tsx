"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ArrowRight, CircleCheck, ReceiptText } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, Skeleton } from "@/components/ui";
import { customerApi } from "@/lib/api/client/customer";
import { paths } from "@/lib/config/routes";
import { formatDateTime, formatINR, formatKg } from "@/lib/format";
import { bookingStatusLabel, bookingStatusTone } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import { BookingIdCopy } from "@/features/tracking/BookingIdCopy";

/** `/customer/booking-confirmation?bookingId=…` — shown after the server has confirmed the payment. */
export function BookingConfirmationView() {
  const bookingId = useSearchParams().get("bookingId");
  const booking = useApi(bookingId ? `customer:booking:${bookingId}` : null, (signal) => customerApi.booking(bookingId!, signal));
  const router = useRouter();
  const b = booking.data;
  const paid = b?.payment?.status === "succeeded" || (b?.payment?.status ?? "").startsWith("refund");
  const unpaid = !!b && !paid;

  // Not paid (yet) → back to the payment step, which explains the state.
  useEffect(() => {
    if (unpaid && bookingId) router.replace(paths.customer.payment(bookingId));
  }, [unpaid, bookingId, router]);

  if (!bookingId || isNotFound(booking.error)) {
    return (
      <>
        <h1 className="type-h2 mb-6 text-ink">Booking</h1>
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title="Booking not found"
          description="We couldn't find this booking on your account."
          action={{ label: "My Shipments", href: paths.customer.shipments }}
        />
      </>
    );
  }
  if (booking.error) return <LoadError error={booking.error} title="We couldn't load your booking" onRetry={() => void booking.reload()} />;
  if (!b || unpaid) return <ConfirmationSkeleton />;

  const agency = b.trip.agency.name;
  let message: ReactNode;
  if (b.status === "cancelled") message = <>This booking was cancelled. Your payment is being refunded to the original method.</>;
  else message = <>We received your payment and {agency} has your space. Share the pickup OTP on the shipment page with the driver at pickup.</>;

  return (
    <div className="mx-auto max-w-[720px]">
      <Card as="section" aria-labelledby="confirmation-heading" padding="lg">
        <div className="flex flex-col items-center text-center">
          <span aria-hidden="true" className="flex size-20 items-center justify-center rounded-full bg-mint-100 text-green-600 motion-safe:animate-pop-in">
            <CircleCheck strokeWidth={1.75} className="size-11" />
          </span>
          <h1 id="confirmation-heading" className="type-h2 mt-4 text-ink">
            Booking confirmed!
          </h1>
          <div className="mt-3" data-testid="booking-status">
            <Badge tone={bookingStatusTone(b.status)} size="md">
              {bookingStatusLabel(b.status)}
            </Badge>
          </div>
          <p className="mt-3 max-w-md text-sm text-ink-muted sm:text-base">{message}</p>
          <BookingIdCopy bookingId={b.id} className="mt-4 justify-center" />
        </div>

        <dl className="mt-6 divide-y divide-border rounded-md border border-border text-sm sm:text-base">
          <Row term="Route" value={`${b.trip.pickup.placeName} → ${b.trip.drop.placeName}`} />
          <Row term="Pickup" value={formatDateTime(b.trip.pickup.expectedDepartureAt)} />
          <Row term="Weight" value={formatKg(b.shipment.package.weightKg)} />
          <Row term="Vehicle" value={`${agency} · ${b.trip.vehicle.vehicleClass}`} />
          <Row
            term="Amount paid"
            value={
              <span className="font-semibold tabular-nums text-price" data-testid="amount-paid">
                {formatINR(b.payment?.amountRupees ?? b.pricing.totalPayable)}
              </span>
            }
          />
          {b.payment?.methodLabel ? <Row term="Payment method" value={b.payment.methodLabel} /> : null}
        </dl>

        <div className="mt-6 flex flex-col gap-3">
          <ButtonLink href={paths.customer.tracking(b.id)} size="lg" fullWidth trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />}>
            Track shipment
          </ButtonLink>
          <div className="grid gap-3 sm:grid-cols-2">
            <ButtonLink href={paths.customer.newShipment()} variant="outline" fullWidth>
              Ship something else
            </ButtonLink>
            <ButtonLink href={paths.customer.shipments} variant="outline" fullWidth>
              View my shipments
            </ButtonLink>
          </div>
        </div>
      </Card>
    </div>
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

export function ConfirmationSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[720px] rounded-lg border border-border bg-surface p-6 shadow-card lg:p-8">
      <span className="sr-only">Loading booking…</span>
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-20" rounded="full" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-6 w-56" rounded="full" />
        <Skeleton lines={2} className="w-full max-w-md" />
      </div>
      <Skeleton lines={5} className="mt-6" />
      <Skeleton className="mt-6 h-13" />
    </div>
  );
}
