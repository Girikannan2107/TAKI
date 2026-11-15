"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CircleAlert, LockKeyhole, ReceiptText, Truck } from "lucide-react";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, EmptyState, Skeleton, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { customerApi } from "@/lib/api/client/customer";
import type { CustomerBookingDTO } from "@/lib/api/contracts/customer";
import { errorMessage, isApiError, newIdempotencyKey } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import type { BookingStatus } from "@/lib/domain/model";
import { formatDateTime, formatINR, formatInstantDate, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { BookingSummary } from "@/features/booking/BookingSummary";
import { bookingStatusLabel, bookingStatusTone } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import { openCashfreeCheckout } from "./cashfree-checkout";
import { paymentsApi } from "@/lib/api/client/payments";

export const PAID_STATUSES: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];

/** `/customer/payment?bookingId=…` — pay for an accepted booking inside the payment window (P3 §4.3). */
export function PaymentView() {
  const bookingId = useSearchParams().get("bookingId");
  const booking = useApi(bookingId ? `customer:booking:${bookingId}` : null, (signal) => customerApi.booking(bookingId!, signal));
  const router = useRouter();
  const paid = booking.data ? PAID_STATUSES.includes(booking.data.status) : false;

  // Already paid (or paid in another tab) → confirmation.
  useEffect(() => {
    if (paid && bookingId) router.replace(paths.customer.confirmation(bookingId));
  }, [paid, bookingId, router]);

  const header = (
    <PageHeader
      title="Payment"
      backHref={bookingId ? paths.customer.tracking(bookingId) : paths.customer.shipments}
      backLabel={bookingId ? "Back to shipment details" : "Back to my shipments"}
    />
  );

  if (!bookingId || isNotFound(booking.error)) {
    return (
      <>
        {header}
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title="Booking not found"
          description="We couldn't find this booking on your account."
          action={{ label: "My Shipments", href: paths.customer.shipments }}
        />
      </>
    );
  }
  if (booking.loading || paid) {
    return (
      <>
        {header}
        <PaymentSkeleton />
      </>
    );
  }
  if (booking.error || !booking.data) {
    return (
      <>
        {header}
        <LoadError error={booking.error} title="We couldn't load this booking" onRetry={() => void booking.reload()} />
      </>
    );
  }
  return (
    <>
      {header}
      <PayPanel b={booking.data} onChanged={() => void booking.reload()} />
    </>
  );
}

function PayPanel({ b, onChanged }: { b: CustomerBookingDTO; onChanged(): void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(params.get("failed") ? "Your payment didn't go through. No money was taken; you can try again." : null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** One key per attempt; replaced only after a definitive failure. */
  const attemptKey = useRef<string | null>(null);
  const busy = useRef(false);
  const errorId = useId();

  if (!b.canPay) {
    const waiting = b.status === "awaiting_agency";
    return (
      <Card as="section" aria-labelledby="pay-status-heading" padding="lg" className="mx-auto max-w-[720px] text-center">
        <h2 id="pay-status-heading" className="type-h3 text-ink">
          {waiting ? "Waiting for the agency to accept" : "This booking can't be paid"}
        </h2>
        <div className="mt-3 flex justify-center">
          <Badge tone={bookingStatusTone(b.status)} size="md">
            {bookingStatusLabel(b.status)}
          </Badge>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          {waiting ? (
            <>
              You can pay for <span className="font-medium tabular-nums text-ink">{b.id}</span> once {b.trip.agency.name} accepts. No money has been taken.
            </>
          ) : (
            <>
              Booking <span className="font-medium tabular-nums text-ink">{b.id}</span> isn&apos;t waiting for payment.
            </>
          )}
        </p>
        <ButtonLink href={paths.customer.tracking(b.id)} className="mt-5">
          View shipment details
        </ButtonLink>
      </Card>
    );
  }

  async function pay() {
    if (busy.current) return;
    busy.current = true;
    setPaying(true);
    setError(null);
    attemptKey.current ??= newIdempotencyKey("pay");
    try {
      const order = await paymentsApi.createOrder(b.id, attemptKey.current);
      if (order.checkout.kind === "dev") {
        router.push(order.checkout.url);
        return;
      }
      await openCashfreeCheckout(order.checkout.mode, order.checkout.paymentSessionId);
      return; // Cashfree navigates to the return page.
    } catch (e) {
      if (!isApiError(e) || e.status < 500) attemptKey.current = null;
      setError(errorMessage(e, "We couldn't start the payment. Please try again."));
      if (isApiError(e) && (e.code === "payment_window_closed" || e.code === "invalid_transition" || e.code === "already_paid")) onChanged();
    }
    busy.current = false;
    setPaying(false);
  }

  async function cancel() {
    setCancelling(true);
    try {
      await customerApi.cancelBooking(b.id);
      toast({ title: "Booking cancelled", description: "No payment was taken.", tone: "info" });
      router.replace(paths.customer.tracking(b.id));
    } catch (e) {
      toast({ title: "Couldn't cancel the booking", description: errorMessage(e), tone: "error" });
      setCancelling(false);
      setConfirmCancel(false);
    }
  }

  const agency = b.trip.agency.name;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
      <div className="lg:col-start-2 lg:row-start-1">
        <Card as="section" aria-label="Your booking" padding="md" className="lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-5">
              <Truck strokeWidth={1.75} />
            </span>
            <p className="min-w-0 flex-1 overflow-hidden pt-2 text-sm text-ink-muted" data-testid="payment-booking-line">
              <span className="-ml-4 flex flex-wrap gap-y-0.5">
                <MetaItem className="font-semibold text-ink">{agency}</MetaItem>
                <MetaItem>
                  {b.trip.pickup.placeName} <span aria-hidden="true">→</span>
                  <span className="sr-only">to</span> {b.trip.drop.placeName}
                </MetaItem>
                <MetaItem>{formatKg(b.shipment.package.weightKg)}</MetaItem>
                <MetaItem>{formatInstantDate(b.trip.pickup.expectedDepartureAt)}</MetaItem>
              </span>
            </p>
          </div>
          <BookingSummary
            pricing={b.pricing}
            className="mt-4 rounded-none border-0 border-t border-border bg-transparent px-0 pb-0 pt-4 shadow-none sm:px-0 sm:pb-0 sm:pt-4"
            footnote={b.paymentDueAt ? `Accepted by ${agency}. Pay by ${formatDateTime(b.paymentDueAt)} to keep your space.` : `Accepted by ${agency}.`}
          />
        </Card>
      </div>

      <Card as="section" aria-labelledby="pay-heading" padding="md" className="lg:col-start-1 lg:row-start-1">
        <h2 id="pay-heading" className="type-h3 text-ink">
          Pay securely
        </h2>
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
          <LockKeyhole aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-green-700" />
          You&apos;ll choose UPI, card or net banking on the payment page. TAKI never sees your card or bank details, and your booking is confirmed only
          after the payment provider confirms it.
        </p>
        {b.status === "payment_failed" && !error ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-ink-muted">
            <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-px size-4.5 shrink-0 text-error" />
            Your last payment attempt didn&apos;t go through. You can try again.
          </p>
        ) : null}
        <div role="alert" aria-live="assertive" className="empty:hidden">
          {error ? (
            <p
              id={errorId}
              data-testid="payment-error"
              className="mt-4 flex items-start gap-2 rounded-md border border-error/30 bg-danger-100 px-3.5 py-3 text-sm font-medium text-error"
            >
              <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-px size-4.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <Button
          size="lg"
          fullWidth
          onClick={pay}
          loading={paying}
          aria-describedby={error ? errorId : undefined}
          trailingIcon={paying ? undefined : <ArrowRight aria-hidden="true" strokeWidth={2} />}
          className="mt-5 h-14 text-lg"
          data-testid="pay-button"
        >
          {paying ? "Opening payment page…" : `Pay ${formatINR(b.pricing.totalPayable)}`}
        </Button>
        <p role="status" aria-live="polite" className="sr-only">
          {paying ? "Opening payment page…" : ""}
        </p>

        {b.canCancel ? (
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)} disabled={paying}>
              Cancel booking
            </Button>
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this booking?"
        description="The booking will be cancelled and the space released. No payment has been taken."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        tone="danger"
        loading={cancelling}
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

/** A no-wrap meta item with its separator dot inside its own left padding. */
function MetaItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative whitespace-nowrap pl-4", className)}>
      <span aria-hidden="true" className="absolute left-1.5 font-normal text-border-strong">
        ·
      </span>
      {children}
    </span>
  );
}

export function PaymentSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
      <span className="sr-only">Loading payment…</span>
      <div className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-card lg:col-start-2 lg:row-start-1">
        <Skeleton lines={2} />
        <Skeleton lines={3} />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-card lg:col-start-1 lg:row-start-1">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-16" />
        <Skeleton className="h-14" />
      </div>
    </div>
  );
}
