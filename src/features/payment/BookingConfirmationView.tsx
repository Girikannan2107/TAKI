"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ArrowRight, CircleCheck, ReceiptText } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, Skeleton } from "@/components/ui";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { BookingIdCopy } from "@/features/tracking/BookingIdCopy";
import { CancelPaidBooking } from "@/features/tracking/CancelPaidBooking";
import { settledPayment, shipmentPath, useOwnedBooking } from "@/features/tracking/booking-access";
import { paths } from "@/lib/config/routes";
import { customerStatusLabel, paymentMethodLabel, statusTone } from "@/lib/domain/labels";
import { getVehicleModel } from "@/lib/domain/vehicles";
import { formatDate, formatINR, formatKg, formatTime, routeLabel } from "@/lib/format";

/** `/customer/booking-confirmation?bookingId=…` — shown after a successful (demo) payment. */
export function BookingConfirmationView() {
  const bookingId = useSearchParams().get("bookingId");
  const { ready, details } = useOwnedBooking(bookingId);
  const router = useRouter();
  const payment = details ? settledPayment(details.payments) : undefined;
  const unpaid = Boolean(details && !payment);

  // Not paid yet → back to the payment step (it handles cancelled/unpayable bookings too).
  useEffect(() => {
    if (ready && unpaid && bookingId) router.replace(paths.customer.payment(bookingId));
  }, [ready, unpaid, bookingId, router]);

  if (!ready || unpaid) return <ConfirmationSkeleton />;

  if (!details || !payment) {
    return (
      <>
        <h1 className="type-h2 mb-6 text-ink">Booking</h1>
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title="Booking not found"
          description="We couldn't find this booking on your account."
          action={{ label: "Back to dashboard", href: paths.customer.dashboard }}
        />
      </>
    );
  }

  const { booking, route, vehicle, driver } = details;
  const provider = driver?.businessName ?? "The transport provider";
  const vehicleLabel = vehicle ? (getVehicleModel(vehicle.modelId)?.label ?? vehicle.modelId) : null;
  const pathIds = shipmentPath(booking, route);

  let message: ReactNode;
  switch (booking.status) {
    case "awaiting_driver":
      message = (
        <>
          Your payment was received (demo — no money moved). {provider} will confirm your booking shortly. If they decline,
          you&apos;ll be refunded.
        </>
      );
      break;
    case "declined":
      message = <>{provider} declined this booking. Your demo payment has been refunded (no money moved).</>;
      break;
    case "cancelled":
      message = <>This booking was cancelled. Your demo payment has been refunded (no money moved).</>;
      break;
    default:
      message = <>Your payment was received (demo — no money moved). {provider} has accepted your booking.</>;
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <Card as="section" aria-labelledby="confirmation-heading" padding="lg">
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="flex size-20 items-center justify-center rounded-full bg-mint-100 text-green-600 motion-safe:animate-pop-in"
          >
            <CircleCheck strokeWidth={1.75} className="size-11" />
          </span>
          <h1 id="confirmation-heading" className="type-h2 mt-4 text-ink">
            Booking placed!
          </h1>
          <div className="mt-3" data-testid="booking-status">
            <Badge tone={statusTone(booking.status)} size="md">
              {customerStatusLabel(booking.status)}
            </Badge>
          </div>
          <p className="mt-3 max-w-md text-sm text-ink-muted sm:text-base">{message}</p>
          <BookingIdCopy bookingId={booking.id} className="mt-4 justify-center" />
        </div>

        <dl className="mt-6 divide-y divide-border rounded-md border border-border text-sm sm:text-base">
          <Row term="Route" value={routeLabel(pathIds)} />
          <Row
            term="Pickup date"
            value={route ? `${formatDate(booking.shipment.pickupDate)} · ${formatTime(route.departureTime)}` : formatDate(booking.shipment.pickupDate)}
          />
          <Row term="Weight" value={formatKg(booking.shipment.weightKg)} />
          <Row term="Vehicle" value={vehicleLabel ? `${provider} · ${vehicleLabel}` : provider} />
          <Row
            term="Amount paid"
            value={
              <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span className="font-semibold tabular-nums text-price" data-testid="amount-paid">
                  {formatINR(payment.amount)}
                </span>
                <Badge tone="paid">Demo payment</Badge>
              </span>
            }
          />
          <Row term="Payment method" value={paymentMethodLabel(payment.method)} />
        </dl>

        <DemoBanner kind="payment" className="mt-5">
          This is a demo. No money moved and no card or bank details were collected.
        </DemoBanner>

        <div className="mt-6 flex flex-col gap-3">
          <ButtonLink
            href={paths.customer.tracking(booking.id)}
            size="lg"
            fullWidth
            trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />}
          >
            Track Shipment
          </ButtonLink>
          <div className="grid gap-3 sm:grid-cols-2">
            <ButtonLink href={paths.customer.dashboard} variant="outline" fullWidth>
              Book another shipment
            </ButtonLink>
            <ButtonLink href={paths.customer.shipments} variant="outline" fullWidth>
              View my shipments
            </ButtonLink>
          </div>
          {booking.status === "awaiting_driver" ? <CancelPaidBooking booking={booking} route={route} /> : null}
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
