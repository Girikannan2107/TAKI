"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CircleAlert, ReceiptText, Truck } from "lucide-react";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, EmptyState, Skeleton, useToast } from "@/components/ui";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { BookingSummary } from "@/features/booking/BookingSummary";
import { PAID_STATUSES, PAYABLE_STATUSES, useOwnedBooking } from "@/features/tracking/booking-access";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import { customerStatusLabel, statusTone } from "@/lib/domain/labels";
import type { PaymentMethod } from "@/lib/domain/types";
import { formatDate, formatDateTime, formatINR, formatKg } from "@/lib/format";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { newIdempotencyKey, paymentService } from "@/lib/services/payment";
import { cn } from "@/lib/utils/cn";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

const FAILED_MESSAGE = "Payment failed (demo). You can try again.";

/** Screen 09 — `/customer/payment?bookingId=…`. */
export function PaymentView() {
  const bookingId = useSearchParams().get("bookingId");
  const { ready, details } = useOwnedBooking(bookingId);
  const router = useRouter();
  const { toast } = useToast();

  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** One key per attempt; replaced only after a failed attempt. */
  const attemptKey = useRef<string | null>(null);
  /** Synchronous guard: a double-click never starts a second pay() call. */
  const busy = useRef(false);
  const errorId = useId();
  const failId = useId();

  const status = details?.booking.status;
  const alreadyPaid = status ? PAID_STATUSES.includes(status) : false;

  // Already paid (or paid in another tab) → confirmation.
  useEffect(() => {
    if (ready && alreadyPaid && bookingId && !leaving) router.replace(paths.customer.confirmation(bookingId));
  }, [ready, alreadyPaid, bookingId, leaving, router]);

  const backHref = details ? paths.customer.booking(details.booking.routeId) : paths.customer.dashboard;
  const header = (
    <PageHeader title="Payment" backHref={backHref} backLabel={details ? "Back to booking details" : "Back to dashboard"} />
  );

  if (!ready || alreadyPaid || leaving) {
    return (
      <>
        {header}
        <PaymentSkeleton />
      </>
    );
  }

  if (!details || !bookingId) {
    return (
      <>
        {header}
        <EmptyState
          icon={<ReceiptText strokeWidth={1.75} />}
          title="Booking not found"
          description="We couldn't find this booking on your account. Start a new search to book a vehicle."
          action={{ label: "Back to dashboard", href: paths.customer.dashboard }}
        />
      </>
    );
  }

  const { booking, driver } = details;
  const payable = PAYABLE_STATUSES.includes(booking.status);

  if (!payable) {
    const waiting = booking.status === "awaiting_driver";
    return (
      <>
        {header}
        <Card as="section" aria-labelledby="pay-status-heading" padding="lg" className="mx-auto max-w-[720px] text-center">
          <h2 id="pay-status-heading" className="type-h3 text-ink">
            {waiting ? "Waiting for the driver to accept" : "This booking can’t be paid"}
          </h2>
          <div className="mt-3 flex justify-center">
            <Badge tone={statusTone(booking.status)} size="md">
              {customerStatusLabel(booking.status)}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {waiting ? (
              <>
                You&apos;ll be able to pay for{" "}
                <span className="font-medium tabular-nums text-ink">{booking.id}</span> once{" "}
                {driver?.businessName ?? "the driver"} accepts and confirms the final price. No money has been taken.
              </>
            ) : (
              <>
                Booking <span className="font-medium tabular-nums text-ink">{booking.id}</span> is no longer awaiting
                payment. No money has been taken.
              </>
            )}
          </p>
          <ButtonLink href={waiting ? paths.customer.tracking(booking.id) : paths.customer.dashboard} className="mt-5">
            {waiting ? "View request status" : "Back to dashboard"}
          </ButtonLink>
        </Card>
      </>
    );
  }

  const total = booking.pricing.totalPayable;
  const providerName = driver?.businessName ?? "Transport provider";
  const showRetryNote = !error && !paying && booking.status === "payment_failed";

  async function pay() {
    if (busy.current || !bookingId) return;
    busy.current = true;
    setPaying(true);
    setError(null);
    attemptKey.current ??= newIdempotencyKey(bookingId);
    try {
      const payment = await paymentService.pay({
        bookingId,
        method,
        idempotencyKey: attemptKey.current,
        simulateFailure: paymentService.mode === "demo" ? simulateFailure : undefined,
      });
      if (payment.status === "succeeded") {
        setLeaving(true);
        router.replace(paths.customer.confirmation(bookingId));
        return;
      }
      attemptKey.current = null; // the next attempt is a new payment
      setError(FAILED_MESSAGE);
    } catch (e) {
      setError(errorMessage(e, FAILED_MESSAGE));
    }
    busy.current = false;
    setPaying(false);
  }

  async function cancel() {
    if (!bookingId) return;
    setCancelling(true);
    try {
      await marketplace.cancelBooking(bookingId);
      setLeaving(true);
      toast({ title: "Booking cancelled", description: "No payment was taken.", tone: "info" });
      router.replace(paths.customer.dashboard);
    } catch (e) {
      toast({ title: "Couldn't cancel the booking", description: errorMessage(e), tone: "error" });
      setCancelling(false);
      setConfirmCancel(false);
    }
  }

  return (
    <>
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
        {/* Summary — first on mobile, right column (sticky) on desktop */}
        <div className="lg:col-start-2 lg:row-start-1">
          <Card as="section" aria-label="Your booking" padding="md" className="lg:sticky lg:top-8">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700 [&_svg]:size-5"
              >
                <Truck strokeWidth={1.75} />
              </span>
              {/* Each item carries its own leading "·" in the left padding; the wrapper's negative margin +
                  the outer overflow-hidden clip the dot of whichever item starts a line, so a separator
                  never starts or ends a line. */}
              <p className="min-w-0 flex-1 overflow-hidden pt-2 text-sm text-ink-muted" data-testid="payment-booking-line">
                <span className="-ml-4 flex flex-wrap gap-y-0.5">
                  <MetaItem className="font-semibold text-ink">{providerName}</MetaItem>
                  <MetaItem>
                    {cityName(booking.shipment.sourceCityId)} <span aria-hidden="true">→</span>
                    <span className="sr-only">to</span> {cityName(booking.shipment.destinationCityId)}
                  </MetaItem>
                  <MetaItem>{formatKg(booking.shipment.weightKg)}</MetaItem>
                  <MetaItem>{formatDate(booking.shipment.pickupDate)}</MetaItem>
                </span>
              </p>
            </div>
            <BookingSummary
              pricing={booking.pricing}
              className="mt-4 rounded-none border-0 border-t border-border bg-transparent px-0 pb-0 pt-4 shadow-none sm:px-0 sm:pb-0 sm:pt-4"
              footnote={
                booking.paymentDueAt
                  ? `Final price confirmed by ${providerName}. Pay by ${formatDateTime(booking.paymentDueAt)} to keep your space.`
                  : `Final price confirmed by ${providerName}.`
              }
            />
          </Card>
        </div>

        {/* Method + pay */}
        <Card as="section" aria-label="Payment method" padding="md" className="lg:col-start-1 lg:row-start-1">
          <PaymentMethodSelector value={method} onChange={setMethod} disabled={paying} />

          <DemoBanner kind="payment" className="mt-5" data-testid="payment-demo-banner">
            No card or bank details are collected.
          </DemoBanner>

          {paymentService.mode === "demo" ? (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm text-ink-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green-700">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.checked)}
                disabled={paying}
                aria-describedby={failId}
                className="size-5 shrink-0 cursor-pointer accent-green-700 focus-visible:outline-none"
              />
              <span>
                Simulate a failed payment (demo)
                <span id={failId} className="sr-only">
                  {" "}
                  Tests the error path. No money moves either way.
                </span>
              </span>
            </label>
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
          {showRetryNote ? (
            <p className="mt-4 flex items-start gap-2 text-sm text-ink-muted">
              <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-px size-4.5 shrink-0 text-error" />
              Your last payment attempt didn&apos;t go through (demo). You can try again.
            </p>
          ) : null}

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
            {paying ? "Processing demo payment…" : `Pay ${formatINR(total)}`}
          </Button>
          <p role="status" aria-live="polite" className="sr-only">
            {paying ? "Processing demo payment…" : ""}
          </p>

          <div className="mt-3 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)} disabled={paying}>
              Cancel booking
            </Button>
          </div>
        </Card>
      </div>

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
    </>
  );
}

/** A no-wrap meta item with its separator dot inside its own left padding (see the line above). */
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
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-14" />
      </div>
    </div>
  );
}
